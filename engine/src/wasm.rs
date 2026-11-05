//! wasm-bindgen surface: JSON in, JSON out, so the JS side needs no generated types.

use wasm_bindgen::prelude::*;

use crate::{derive, derive_steps, Config, Event};

/// `config`: a `Config` as JSON; `events`: an `Event` array as JSON. Returns the `Derived` snapshot as JSON.
#[wasm_bindgen(js_name = deriveJson)]
pub fn derive_json(config: &str, events: &str) -> Result<String, JsError> {
    let config: Config = serde_json::from_str(config)?;
    let events: Vec<Event> = serde_json::from_str(events)?;
    Ok(serde_json::to_string(&derive(&config, &events))?)
}

/// Same inputs; returns the game state after each event as a JSON array.
#[wasm_bindgen(js_name = deriveStepsJson)]
pub fn derive_steps_json(config: &str, events: &str) -> Result<String, JsError> {
    let config: Config = serde_json::from_str(config)?;
    let events: Vec<Event> = serde_json::from_str(events)?;
    Ok(serde_json::to_string(&derive_steps(&config, &events))?)
}
