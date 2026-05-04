use daemon_core::domain::{DomainResult, EventEnvelope};
use daemon_core::ports::{AuditEventRepository, EventFilter, EventRepository};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

pub struct EventBus {
    events: Mutex<Vec<EventEnvelope>>,
    sender: broadcast::Sender<EventEnvelope>,
    audit: Arc<dyn AuditEventRepository>,
}

impl EventBus {
    pub fn with_audit(audit: Arc<dyn AuditEventRepository>) -> Result<Self, String> {
        let events = audit
            .list_audit_events(&EventFilter::default())
            .map_err(|error| error.message.clone())?;
        let (sender, _) = broadcast::channel(256);
        Ok(Self {
            events: Mutex::new(events),
            sender,
            audit,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<EventEnvelope> {
        self.sender.subscribe()
    }
}

impl EventRepository for EventBus {
    fn publish_event(&self, event: EventEnvelope) -> DomainResult<()> {
        let mut events = self.events.lock().unwrap();
        self.audit.append_audit_event(event.clone())?;
        events.push(event.clone());
        let _ = self.sender.send(event);
        Ok(())
    }

    fn list_events(&self, filter: &EventFilter) -> DomainResult<Vec<EventEnvelope>> {
        self.audit.list_audit_events(filter)
    }
}
