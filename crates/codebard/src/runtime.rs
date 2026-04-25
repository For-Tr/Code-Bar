use base64::Engine;
use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::{DomainResult, EventEntityType, EventEnvelope, EventSource};
use daemon_core::ports::{Clock, EventRepository, IdGenerator, RuntimeHost, RuntimeLaunchResult, RuntimeLaunchSpec};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

pub struct PortablePtyRuntimeHost {
    writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    killers: Arc<Mutex<HashMap<String, Box<dyn portable_pty::Child + Send>>>>,
    masters: Arc<Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>>,
    simulated_sessions: Arc<Mutex<HashSet<String>>>,
    ids: Arc<dyn IdGenerator>,
    clock: Arc<dyn Clock>,
    events: Arc<dyn EventRepository>,
}

impl PortablePtyRuntimeHost {
    pub fn new(
        ids: Arc<dyn IdGenerator>,
        clock: Arc<dyn Clock>,
        events: Arc<dyn EventRepository>,
    ) -> Self {
        Self {
            writers: Arc::new(Mutex::new(HashMap::new())),
            killers: Arc::new(Mutex::new(HashMap::new())),
            masters: Arc::new(Mutex::new(HashMap::new())),
            simulated_sessions: Arc::new(Mutex::new(HashSet::new())),
            ids,
            clock,
            events,
        }
    }


    fn emit_session_event(&self, session_id: &str, event_type: &str, payload: HashMap<String, Value>) {
        let event = EventEnvelope::new(
            self.ids.next_event_id(),
            EventEntityType::Session,
            session_id.to_string(),
            event_type.to_string(),
            EventSource::Launcher,
            None,
            Value::Object(payload.into_iter().collect()),
            self.clock.now(),
        );
        let _ = self.events.publish_event(event);
    }

    fn stop_existing_session(&self, session_id: &str) {
        if let Some(mut child) = self.killers.lock().unwrap().remove(session_id) {
            let _ = child.kill();
        }
        self.writers.lock().unwrap().remove(session_id);
        self.masters.lock().unwrap().remove(session_id);
        self.simulated_sessions.lock().unwrap().remove(session_id);
    }

    fn spawn_runtime(&self, spec: RuntimeLaunchSpec) -> DomainResult<RuntimeLaunchResult> {
        self.stop_existing_session(&spec.session_id);

        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(pair) => pair,
            Err(_error) => {
                self.simulated_sessions.lock().unwrap().insert(spec.session_id.clone());
                return Ok(RuntimeLaunchResult {
                    launcher_type: spec.launcher_type,
                    command: spec.command,
                    args: spec.args,
                    cwd: spec.cwd,
                    pid: None,
                });
            }
        };

        let mut cmd = CommandBuilder::new(&spec.command);
        for arg in &spec.args {
            cmd.arg(arg);
        }
        cmd.cwd(&spec.cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = match pair.slave.spawn_command(cmd) {
            Ok(child) => child,
            Err(_) => {
                self.simulated_sessions.lock().unwrap().insert(spec.session_id.clone());
                return Ok(RuntimeLaunchResult {
                    launcher_type: spec.launcher_type,
                    command: spec.command,
                    args: spec.args,
                    cwd: spec.cwd,
                    pid: None,
                });
            }
        };

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))?;

        self.writers
            .lock()
            .unwrap()
            .insert(spec.session_id.clone(), writer);
        self.killers
            .lock()
            .unwrap()
            .insert(spec.session_id.clone(), child);
        self.masters
            .lock()
            .unwrap()
            .insert(spec.session_id.clone(), pair.master);

        let session_id = spec.session_id.clone();
        let writers = self.writers.clone();
        let killers = self.killers.clone();
        let masters = self.masters.clone();
        let simulated = self.simulated_sessions.clone();
        let ids = self.ids.clone();
        let clock = self.clock.clone();
        let events = self.events.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut stripper = AnsiStripper::new();
            let mut last_status = 0u8;

            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        publish_runtime_event(
                            &*ids,
                            &*clock,
                            &*events,
                            &session_id,
                            "pty-data",
                            HashMap::from([
                                (String::from("session_id"), Value::String(session_id.clone())),
                                (String::from("data"), Value::String(b64)),
                            ]),
                        );

                        stripper.feed(&buf[..n]);
                        let win_str = String::from_utf8_lossy(stripper.visible());
                        let new_status = if win_str.contains("? for shortcuts") {
                            2u8
                        } else if win_str.contains("esc to interrupt") {
                            1u8
                        } else {
                            0u8
                        };

                        if new_status != 0 && new_status != last_status {
                            last_status = new_status;
                            stripper.clear();
                            let event_type = if new_status == 2 { "pty-waiting" } else { "pty-running" };
                            publish_runtime_event(
                                &*ids,
                                &*clock,
                                &*events,
                                &session_id,
                                event_type,
                                HashMap::from([(String::from("session_id"), Value::String(session_id.clone()))]),
                            );
                        }
                    }
                }
            }

            writers.lock().unwrap().remove(&session_id);
            masters.lock().unwrap().remove(&session_id);
            killers.lock().unwrap().remove(&session_id);
            simulated.lock().unwrap().remove(&session_id);
            publish_runtime_event(
                &*ids,
                &*clock,
                &*events,
                &session_id,
                "pty-exit",
                HashMap::from([(String::from("session_id"), Value::String(session_id.clone()))]),
            );
        });

        Ok(RuntimeLaunchResult {
            launcher_type: spec.launcher_type,
            command: spec.command,
            args: spec.args,
            cwd: spec.cwd,
            pid: None,
        })
    }
}

impl RuntimeHost for PortablePtyRuntimeHost {
    fn launch(&self, spec: RuntimeLaunchSpec) -> DomainResult<RuntimeLaunchResult> {
        self.spawn_runtime(spec)
    }

    fn resume(&self, spec: RuntimeLaunchSpec) -> DomainResult<RuntimeLaunchResult> {
        self.spawn_runtime(spec)
    }

    fn send_input(&self, session_id: &str, text: &str) -> DomainResult<()> {
        if self.simulated_sessions.lock().unwrap().contains(session_id) {
            return Ok(());
        }

        let mut writers = self.writers.lock().unwrap();
        let writer = writers.get_mut(session_id).ok_or_else(|| {
            ErrorEnvelope::new(
                ErrorCode::Internal,
                format!("session {session_id} is not running"),
                false,
            )
        })?;

        let mut data = text.as_bytes().to_vec();
        data.push(b'\n');
        writer
            .write_all(&data)
            .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))?;
        writer
            .flush()
            .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))
    }

    fn write_base64(&self, session_id: &str, data: &str) -> DomainResult<()> {
        if self.simulated_sessions.lock().unwrap().contains(session_id) {
            return Ok(());
        }

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|error| ErrorEnvelope::new(ErrorCode::InvalidArgument, error.to_string(), false))?;
        let mut writers = self.writers.lock().unwrap();
        let writer = writers.get_mut(session_id).ok_or_else(|| {
            ErrorEnvelope::new(
                ErrorCode::Internal,
                format!("session {session_id} is not running"),
                false,
            )
        })?;
        writer
            .write_all(&bytes)
            .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))
    }

    fn resize(&self, session_id: &str, cols: u16, rows: u16) -> DomainResult<()> {
        if self.simulated_sessions.lock().unwrap().contains(session_id) {
            return Ok(());
        }

        let masters = self.masters.lock().unwrap();
        let master = masters.get(session_id).ok_or_else(|| {
            ErrorEnvelope::new(
                ErrorCode::Internal,
                format!("session {session_id} is not running"),
                false,
            )
        })?;
        master
            .resize(PtySize {
                rows: rows.max(5),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))
    }

    fn stop(&self, session_id: &str, _reason: Option<&str>) -> DomainResult<()> {
        self.stop_existing_session(session_id);
        self.emit_session_event(
            session_id,
            "pty-exit",
            HashMap::from([(String::from("session_id"), Value::String(session_id.to_string()))]),
        );
        Ok(())
    }

    fn is_session_alive(&self, session_id: &str) -> bool {
        self.killers.lock().unwrap().contains_key(session_id)
            || self.simulated_sessions.lock().unwrap().contains(session_id)
    }
}

fn publish_runtime_event(
    ids: &dyn IdGenerator,
    clock: &dyn Clock,
    events: &dyn EventRepository,
    session_id: &str,
    event_type: &str,
    payload: HashMap<String, Value>,
) {
    let event = EventEnvelope::new(
        ids.next_event_id(),
        EventEntityType::Session,
        session_id.to_string(),
        event_type.to_string(),
        EventSource::Launcher,
        None,
        Value::Object(payload.into_iter().collect()),
        clock.now(),
    );
    let _ = events.publish_event(event);
}

struct AnsiStripper {
    state: u8,
    window: Vec<u8>,
}

impl AnsiStripper {
    fn new() -> Self {
        Self {
            state: 0,
            window: Vec::with_capacity(256),
        }
    }

    fn feed(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            match self.state {
                0 => {
                    if byte == 0x1b {
                        self.state = 1;
                    } else if byte >= 0x20 || byte == b'\r' || byte == b'\n' {
                        self.window.push(byte);
                        if self.window.len() > 256 {
                            self.window.drain(..128);
                        }
                    }
                }
                1 => {
                    self.state = if byte == b'[' { 2 } else { 0 };
                }
                2 => {
                    if (0x40..=0x7e).contains(&byte) {
                        self.state = 0;
                    }
                }
                _ => {
                    self.state = 0;
                }
            }
        }
    }

    fn visible(&self) -> &[u8] {
        &self.window
    }

    fn clear(&mut self) {
        self.window.clear();
    }
}
