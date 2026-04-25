use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::{DomainResult, EventEnvelope, EventEntityType};
use daemon_core::ports::{EventFilter, EventRepository};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio::sync::broadcast;

pub struct EventBus {
    file_path: PathBuf,
    events: Mutex<Vec<EventEnvelope>>,
    sender: broadcast::Sender<EventEnvelope>,
}

impl EventBus {
    pub fn new(file_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let events = load_events(&file_path)?;
        let (sender, _) = broadcast::channel(256);
        Ok(Self {
            file_path,
            events: Mutex::new(events),
            sender,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<EventEnvelope> {
        self.sender.subscribe()
    }
}

impl EventRepository for EventBus {
    fn publish_event(&self, event: EventEnvelope) -> DomainResult<()> {
        let mut events = self.events.lock().unwrap();
        append_event(&self.file_path, &event)
            .map_err(|message| ErrorEnvelope::new(ErrorCode::Internal, message, true))?;
        events.push(event.clone());
        let _ = self.sender.send(event);
        Ok(())
    }

    fn list_events(&self, filter: &EventFilter) -> DomainResult<Vec<EventEnvelope>> {
        let events = self.events.lock().unwrap();
        let mut filtered = events
            .iter()
            .filter(|event| matches_filter(event, filter))
            .cloned()
            .collect::<Vec<_>>();
        if let Some(limit) = filter.limit {
            if filtered.len() > limit {
                filtered = filtered[filtered.len() - limit..].to_vec();
            }
        }
        Ok(filtered)
    }
}

fn load_events(file_path: &Path) -> Result<Vec<EventEnvelope>, String> {
    let file = match fs::File::open(file_path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let reader = BufReader::new(file);
    let mut events = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let event = serde_json::from_str::<EventEnvelope>(&line).map_err(|error| error.to_string())?;
        events.push(event);
    }
    Ok(events)
}

fn append_event(file_path: &Path, event: &EventEnvelope) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file_path)
        .map_err(|error| error.to_string())?;
    let line = serde_json::to_string(event).map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

pub fn matches_filter(event: &EventEnvelope, filter: &EventFilter) -> bool {
    filter
        .entity_type
        .as_ref()
        .map(|entity_type| normalize_entity_type(entity_type) == normalize_event_entity_type(&event.entity_type))
        .unwrap_or(true)
        && filter
            .entity_id
            .as_ref()
            .map(|entity_id| &event.entity_id == entity_id)
            .unwrap_or(true)
        && filter
            .since
            .as_ref()
            .map(|since| event.created_at >= *since)
            .unwrap_or(true)
}

fn normalize_entity_type(entity_type: &str) -> &'static str {
    match entity_type {
        "task" => "task",
        "session" => "session",
        "run" => "run",
        "worktree" => "worktree",
        "approval" => "approval",
        "tool_call" | "toolCall" => "tool_call",
        _ => "unknown",
    }
}

fn normalize_event_entity_type(entity_type: &EventEntityType) -> &'static str {
    match entity_type {
        EventEntityType::Task => "task",
        EventEntityType::Session => "session",
        EventEntityType::Run => "run",
        EventEntityType::Worktree => "worktree",
        EventEntityType::Approval => "approval",
        EventEntityType::ToolCall => "tool_call",
    }
}
