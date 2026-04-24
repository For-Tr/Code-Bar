pub const CONTRACTS_VERSION: &str = "v1";

pub mod workflow;
pub mod v1 {
    pub use crate::workflow::*;
}
