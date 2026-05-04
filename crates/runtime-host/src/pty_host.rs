use base64::Engine;
use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::{DomainResult, EventEntityType, EventEnvelope, EventSource};
use daemon_core::ports::{
    Clock, EventRepository, IdGenerator, LaunchSpec, ProcessEvent, ProcessHandle, RuntimeHost,
};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use crate::cwd::resolve_cwd;
use crate::env::build_launch_env;
use crate::hooks::{build_bootstrap_prompt, build_user_prompt};
use crate::supervisor::Supervisor;

pub struct PortablePtyRuntimeHost {
    writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    killers: Arc<Mutex<HashMap<String, Box<dyn portable_pty::Child + Send>>>>,
    masters: Arc<Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>>,
    supervisor: Supervisor,
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
            supervisor: Supervisor::default(),
            ids,
            clock,
            events,
        }
    }

    fn emit_session_event(
        &self,
        session_id: &str,
        event_type: &str,
        payload: HashMap<String, Value>,
    ) {
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
        self.supervisor.clear(session_id);
    }

    fn spawn_runtime(&self, spec: LaunchSpec) -> DomainResult<ProcessHandle> {
        self.stop_existing_session(&spec.session_id);

        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(pair) => pair,
            Err(_) => {
                self.supervisor.mark_simulated(&spec.session_id);
                return Ok(ProcessHandle {
                    handle_id: spec.session_id.clone(),
                    pid: None,
                });
            }
        };

        let mut cmd = CommandBuilder::new(&spec.command);
        for arg in &spec.args {
            cmd.arg(arg);
        }
        if let Some(prompt) = build_user_prompt(&spec) {
            cmd.arg(prompt);
        }

        cmd.cwd(&resolve_cwd(&spec));
        for (key, value) in build_launch_env(&spec) {
            cmd.env(key, value);
        }

        if let Some(prompt) = build_bootstrap_prompt(&spec) {
            cmd.env("CODEBAR_BOOTSTRAP_PROMPT", prompt);
        }

        if let Some(provider_session_id) = &spec.provider_session_id {
            cmd.env("CODEBAR_PROVIDER_SESSION_ID", provider_session_id);
        }
        if let Some(bridge_command) = &spec.mcp_bridge_command {
            cmd.env("CODEBAR_MCP_BRIDGE_COMMAND", bridge_command);
        }
        if let Some(bridge_args) = &spec.mcp_bridge_args {
            if let Ok(encoded) = serde_json::to_string(bridge_args) {
                cmd.env("CODEBAR_MCP_BRIDGE_ARGS_JSON", encoded);
            }
        }

        let child = match pair.slave.spawn_command(cmd) {
            Ok(child) => child,
            Err(_) => {
                self.supervisor.mark_simulated(&spec.session_id);
                return Ok(ProcessHandle {
                    handle_id: spec.session_id.clone(),
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

        let session_id = spec.session_id.clone();
        self.writers
            .lock()
            .unwrap()
            .insert(session_id.clone(), writer);
        self.killers
            .lock()
            .unwrap()
            .insert(session_id.clone(), child);
        self.masters
            .lock()
            .unwrap()
            .insert(session_id.clone(), pair.master);

        let writers = self.writers.clone();
        let killers = self.killers.clone();
        let masters = self.masters.clone();
        let supervisor_sessions = self.supervisor.simulated_sessions();
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
                                (
                                    String::from("session_id"),
                                    Value::String(session_id.clone()),
                                ),
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
                            let event_type = if new_status == 2 {
                                "pty-waiting"
                            } else {
                                "pty-running"
                            };
                            publish_runtime_event(
                                &*ids,
                                &*clock,
                                &*events,
                                &session_id,
                                event_type,
                                HashMap::from([(
                                    String::from("session_id"),
                                    Value::String(session_id.clone()),
                                )]),
                            );
                        }
                    }
                }
            }

            writers.lock().unwrap().remove(&session_id);
            masters.lock().unwrap().remove(&session_id);
            killers.lock().unwrap().remove(&session_id);
            supervisor_sessions.lock().unwrap().remove(&session_id);
            publish_runtime_event(
                &*ids,
                &*clock,
                &*events,
                &session_id,
                "pty-exit",
                HashMap::from([(
                    String::from("session_id"),
                    Value::String(session_id.clone()),
                )]),
            );
        });

        Ok(ProcessHandle {
            handle_id: spec.session_id,
            pid: None,
        })
    }
}

impl RuntimeHost for PortablePtyRuntimeHost {
    fn launch(&self, spec: LaunchSpec) -> DomainResult<ProcessHandle> {
        self.spawn_runtime(spec)
    }

    fn send_input(&self, handle_id: &str, text: &str) -> DomainResult<()> {
        if self.supervisor.is_simulated(handle_id) {
            return Ok(());
        }

        let mut writers = self.writers.lock().unwrap();
        let writer = writers.get_mut(handle_id).ok_or_else(|| {
            ErrorEnvelope::new(
                ErrorCode::Internal,
                format!("session {handle_id} is not running"),
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

    fn write_base64(&self, handle_id: &str, data: &str) -> DomainResult<()> {
        if self.supervisor.is_simulated(handle_id) {
            return Ok(());
        }

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|error| {
                ErrorEnvelope::new(ErrorCode::InvalidArgument, error.to_string(), false)
            })?;
        let mut writers = self.writers.lock().unwrap();
        let writer = writers.get_mut(handle_id).ok_or_else(|| {
            ErrorEnvelope::new(
                ErrorCode::Internal,
                format!("session {handle_id} is not running"),
                false,
            )
        })?;
        writer
            .write_all(&bytes)
            .map_err(|error| ErrorEnvelope::new(ErrorCode::Internal, error.to_string(), true))
    }

    fn resize(&self, handle_id: &str, cols: u16, rows: u16) -> DomainResult<()> {
        if self.supervisor.is_simulated(handle_id) {
            return Ok(());
        }

        let masters = self.masters.lock().unwrap();
        let master = masters.get(handle_id).ok_or_else(|| {
            ErrorEnvelope::new(
                ErrorCode::Internal,
                format!("session {handle_id} is not running"),
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

    fn stop(&self, handle_id: &str, _reason: Option<&str>) -> DomainResult<()> {
        self.stop_existing_session(handle_id);
        self.emit_session_event(
            handle_id,
            "pty-exit",
            HashMap::from([(
                String::from("session_id"),
                Value::String(handle_id.to_string()),
            )]),
        );
        Ok(())
    }

    fn poll_events(&self, _handle_id: &str) -> DomainResult<Vec<ProcessEvent>> {
        Ok(Vec::new())
    }

    fn is_handle_alive(&self, handle_id: &str) -> bool {
        self.killers.lock().unwrap().contains_key(handle_id)
            || self.supervisor.is_simulated(handle_id)
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
