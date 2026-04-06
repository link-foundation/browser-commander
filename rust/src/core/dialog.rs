//! Dialog event handling for browser automation.
//!
//! This module provides a unified dialog manager that handles browser dialogs
//! (alert, confirm, prompt, beforeunload) across different browser engines.
//!
//! # Example
//!
//! ```rust,no_run
//! use browser_commander::core::dialog::{DialogEvent, DialogManager};
//!
//! let mut manager = DialogManager::new();
//!
//! // Register a handler that dismisses all dialogs
//! manager.on_dialog(|event| {
//!     // In real usage, you would call event.dismiss() on the actual dialog object
//!     println!("Dialog: {} - {}", event.dialog_type, event.message);
//! });
//! ```

use crate::core::engine::EngineType;
use std::fmt;
use std::sync::{Arc, Mutex};

/// The type of browser dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DialogType {
    /// JavaScript alert() dialog.
    Alert,
    /// JavaScript confirm() dialog.
    Confirm,
    /// JavaScript prompt() dialog.
    Prompt,
    /// Page beforeunload dialog.
    BeforeUnload,
    /// Unknown dialog type.
    Unknown,
}

impl fmt::Display for DialogType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DialogType::Alert => write!(f, "alert"),
            DialogType::Confirm => write!(f, "confirm"),
            DialogType::Prompt => write!(f, "prompt"),
            DialogType::BeforeUnload => write!(f, "beforeunload"),
            DialogType::Unknown => write!(f, "unknown"),
        }
    }
}

impl From<&str> for DialogType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "alert" => DialogType::Alert,
            "confirm" => DialogType::Confirm,
            "prompt" => DialogType::Prompt,
            "beforeunload" => DialogType::BeforeUnload,
            _ => DialogType::Unknown,
        }
    }
}

/// Information about a dialog event.
///
/// This struct is passed to dialog handlers and contains all relevant
/// information about the dialog that was triggered.
#[derive(Debug, Clone)]
pub struct DialogEvent {
    /// The type of dialog.
    pub dialog_type: DialogType,
    /// The message shown in the dialog.
    pub message: String,
    /// Default value for prompt dialogs.
    pub default_value: Option<String>,
}

impl DialogEvent {
    /// Create a new dialog event.
    pub fn new(
        dialog_type: DialogType,
        message: impl Into<String>,
        default_value: Option<String>,
    ) -> Self {
        Self {
            dialog_type,
            message: message.into(),
            default_value,
        }
    }

    /// Create a dialog event from a string type name.
    pub fn from_str_type(
        dialog_type: &str,
        message: impl Into<String>,
        default_value: Option<String>,
    ) -> Self {
        Self::new(DialogType::from(dialog_type), message, default_value)
    }
}

/// A type alias for dialog handler functions.
pub type DialogHandler = Arc<dyn Fn(&DialogEvent) + Send + Sync>;

/// Manages dialog event handlers for browser automation.
///
/// The `DialogManager` allows registering callbacks that are invoked
/// whenever a browser dialog (alert, confirm, prompt) is triggered.
/// It is engine-agnostic: the engine-specific dialog interception
/// logic calls [`DialogManager::dispatch`] when a dialog event occurs.
///
/// # Thread Safety
///
/// `DialogManager` is thread-safe and can be shared across async tasks.
///
/// # Example
///
/// ```rust
/// use browser_commander::core::dialog::{DialogEvent, DialogManager};
///
/// let mut manager = DialogManager::new();
///
/// manager.on_dialog(|event| {
///     println!("Got dialog: {:?} - {}", event.dialog_type, event.message);
/// });
///
/// // Simulate dispatching a dialog (engine would call this internally)
/// let event = DialogEvent::from_str_type("alert", "Hello!", None);
/// manager.dispatch(&event);
/// ```
#[derive(Clone)]
pub struct DialogManager {
    handlers: Arc<Mutex<Vec<DialogHandler>>>,
    engine: EngineType,
}

impl fmt::Debug for DialogManager {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let count = self
            .handlers
            .lock()
            .map(|h| h.len())
            .unwrap_or(0);
        f.debug_struct("DialogManager")
            .field("engine", &self.engine)
            .field("handler_count", &count)
            .finish()
    }
}

impl DialogManager {
    /// Create a new `DialogManager` for the given engine.
    pub fn new_with_engine(engine: EngineType) -> Self {
        Self {
            handlers: Arc::new(Mutex::new(Vec::new())),
            engine,
        }
    }

    /// Create a new `DialogManager` (engine-independent, for testing/simple use).
    pub fn new() -> Self {
        Self::new_with_engine(EngineType::Chromiumoxide)
    }

    /// Register a dialog handler.
    ///
    /// The handler is called synchronously whenever a dialog event is dispatched.
    /// For async handling, dispatch a channel message or use `tokio::spawn` inside
    /// the handler.
    ///
    /// # Arguments
    ///
    /// * `handler` - A function that receives a [`DialogEvent`] reference.
    pub fn on_dialog<F>(&mut self, handler: F)
    where
        F: Fn(&DialogEvent) + Send + Sync + 'static,
    {
        let mut handlers = self.handlers.lock().expect("lock poisoned");
        handlers.push(Arc::new(handler));
    }

    /// Remove all registered dialog handlers.
    pub fn clear_dialog_handlers(&mut self) {
        let mut handlers = self.handlers.lock().expect("lock poisoned");
        handlers.clear();
    }

    /// Get the number of registered handlers.
    pub fn handler_count(&self) -> usize {
        self.handlers.lock().map(|h| h.len()).unwrap_or(0)
    }

    /// Dispatch a dialog event to all registered handlers.
    ///
    /// This is called by the engine-specific integration when a dialog appears.
    /// If no handlers are registered, this is a no-op (the engine integration
    /// should auto-dismiss the dialog in that case).
    ///
    /// # Arguments
    ///
    /// * `event` - The dialog event to dispatch.
    pub fn dispatch(&self, event: &DialogEvent) {
        let handlers = self.handlers.lock().expect("lock poisoned");
        for handler in handlers.iter() {
            handler(event);
        }
    }

    /// Get the engine type this manager is associated with.
    pub fn engine(&self) -> EngineType {
        self.engine
    }
}

impl Default for DialogManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialog_type_from_str() {
        assert_eq!(DialogType::from("alert"), DialogType::Alert);
        assert_eq!(DialogType::from("confirm"), DialogType::Confirm);
        assert_eq!(DialogType::from("prompt"), DialogType::Prompt);
        assert_eq!(DialogType::from("beforeunload"), DialogType::BeforeUnload);
        assert_eq!(DialogType::from("unknown_type"), DialogType::Unknown);
    }

    #[test]
    fn dialog_type_display() {
        assert_eq!(DialogType::Alert.to_string(), "alert");
        assert_eq!(DialogType::Confirm.to_string(), "confirm");
        assert_eq!(DialogType::Prompt.to_string(), "prompt");
        assert_eq!(DialogType::BeforeUnload.to_string(), "beforeunload");
        assert_eq!(DialogType::Unknown.to_string(), "unknown");
    }

    #[test]
    fn dialog_type_case_insensitive() {
        assert_eq!(DialogType::from("ALERT"), DialogType::Alert);
        assert_eq!(DialogType::from("Confirm"), DialogType::Confirm);
    }

    #[test]
    fn dialog_event_new() {
        let event = DialogEvent::new(DialogType::Alert, "Hello!", None);
        assert_eq!(event.dialog_type, DialogType::Alert);
        assert_eq!(event.message, "Hello!");
        assert!(event.default_value.is_none());
    }

    #[test]
    fn dialog_event_from_str_type() {
        let event = DialogEvent::from_str_type("confirm", "Are you sure?", None);
        assert_eq!(event.dialog_type, DialogType::Confirm);
        assert_eq!(event.message, "Are you sure?");
    }

    #[test]
    fn dialog_event_with_default_value() {
        let event = DialogEvent::new(
            DialogType::Prompt,
            "Enter name:",
            Some("default".to_string()),
        );
        assert_eq!(event.dialog_type, DialogType::Prompt);
        assert_eq!(event.default_value, Some("default".to_string()));
    }

    #[test]
    fn dialog_manager_new() {
        let manager = DialogManager::new();
        assert_eq!(manager.handler_count(), 0);
    }

    #[test]
    fn dialog_manager_on_dialog() {
        let mut manager = DialogManager::new();
        manager.on_dialog(|_event| {});
        assert_eq!(manager.handler_count(), 1);

        manager.on_dialog(|_event| {});
        assert_eq!(manager.handler_count(), 2);
    }

    #[test]
    fn dialog_manager_clear_handlers() {
        let mut manager = DialogManager::new();
        manager.on_dialog(|_event| {});
        manager.on_dialog(|_event| {});
        assert_eq!(manager.handler_count(), 2);

        manager.clear_dialog_handlers();
        assert_eq!(manager.handler_count(), 0);
    }

    #[test]
    fn dialog_manager_dispatch_calls_handlers() {
        let mut manager = DialogManager::new();
        let called = Arc::new(Mutex::new(false));
        let called_clone = called.clone();

        manager.on_dialog(move |event| {
            *called_clone.lock().unwrap() = true;
            assert_eq!(event.message, "Test dialog");
            assert_eq!(event.dialog_type, DialogType::Alert);
        });

        let event = DialogEvent::from_str_type("alert", "Test dialog", None);
        manager.dispatch(&event);

        assert!(*called.lock().unwrap());
    }

    #[test]
    fn dialog_manager_dispatch_calls_multiple_handlers() {
        let mut manager = DialogManager::new();
        let count = Arc::new(Mutex::new(0u32));

        let count1 = count.clone();
        manager.on_dialog(move |_| {
            *count1.lock().unwrap() += 1;
        });

        let count2 = count.clone();
        manager.on_dialog(move |_| {
            *count2.lock().unwrap() += 1;
        });

        let event = DialogEvent::from_str_type("confirm", "Are you sure?", None);
        manager.dispatch(&event);

        assert_eq!(*count.lock().unwrap(), 2);
    }

    #[test]
    fn dialog_manager_dispatch_with_no_handlers() {
        let manager = DialogManager::new();
        // Should not panic with no handlers
        let event = DialogEvent::from_str_type("alert", "Hello!", None);
        manager.dispatch(&event);
    }

    #[test]
    fn dialog_manager_is_cloneable() {
        let mut manager = DialogManager::new();
        manager.on_dialog(|_| {});

        let cloned = manager.clone();
        assert_eq!(cloned.handler_count(), 1);
    }

    #[test]
    fn dialog_manager_engine() {
        let manager = DialogManager::new_with_engine(EngineType::Fantoccini);
        assert_eq!(manager.engine(), EngineType::Fantoccini);
    }

    #[test]
    fn dialog_manager_debug() {
        let manager = DialogManager::new();
        let debug_str = format!("{:?}", manager);
        assert!(debug_str.contains("DialogManager"));
    }
}
