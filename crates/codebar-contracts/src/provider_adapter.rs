use crate::{errors::ErrorEnvelope, events::EventEnvelope};

pub trait ProviderAdapter {
    type BindingInput;
    type BindingOutput;

    fn provider_name(&self) -> &'static str;
    fn resolve_binding(&self, input: Self::BindingInput) -> Result<Self::BindingOutput, ErrorEnvelope>;
    fn map_event(&self, payload: serde_json::Value) -> Result<Option<EventEnvelope>, ErrorEnvelope>;
}
