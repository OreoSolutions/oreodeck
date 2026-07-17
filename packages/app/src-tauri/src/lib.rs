pub mod store;
pub mod usage;
pub mod keychain;
pub mod terminal;
pub mod commands;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::list_profiles,
            commands::get_usage,
            commands::set_active,
            commands::add_api_key_profile,
            commands::remove_profile,
            commands::get_failover,
            commands::set_failover_enabled,
            commands::set_failover_order,
            commands::open_session,
            commands::open_login_terminal,
            commands::check_cli,
            commands::open_config_in_editor,
        ])
        .setup(|app| {
            // Menu-bar app: no Dock icon, no App Switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let mut tray_builder = TrayIconBuilder::with_id("ccm-tray");
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _tray = tray_builder
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("tray") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The tray popover dismisses itself when it loses focus.
            if window.label() == "tray" {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
