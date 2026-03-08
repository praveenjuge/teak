use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu,
    SubmenuBuilder,
};
use tauri::{App, Emitter, Manager, Runtime};

const MENU_SETTINGS_ID: &str = "app.settings";
const MENU_CHECK_UPDATES_ID: &str = "app.check_for_updates";
const MENU_LOGOUT_ID: &str = "app.logout";
const MENU_CLOSE_WINDOW_ID: &str = "file.close_window";
const MENU_QUIT_ID: &str = "file.quit";

const MENU_SETTINGS_EVENT: &str = "desktop://menu/settings";
const MENU_CHECK_UPDATES_EVENT: &str = "desktop://menu/check-for-updates";
const MENU_LOGOUT_EVENT: &str = "desktop://menu/logout";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NativeMenuHandler {
    CloseWindow,
    Quit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct MenuAction {
    id: &'static str,
    label: &'static str,
    accelerator: Option<&'static str>,
    event_name: Option<&'static str>,
    native_handler: Option<NativeMenuHandler>,
}

const MENU_ACTIONS: [MenuAction; 5] = [
    MenuAction {
        id: MENU_SETTINGS_ID,
        label: "Settings...",
        accelerator: Some("CmdOrCtrl+,"),
        event_name: Some(MENU_SETTINGS_EVENT),
        native_handler: None,
    },
    MenuAction {
        id: MENU_CHECK_UPDATES_ID,
        label: "Check for Updates...",
        accelerator: None,
        event_name: Some(MENU_CHECK_UPDATES_EVENT),
        native_handler: None,
    },
    MenuAction {
        id: MENU_LOGOUT_ID,
        label: "Log Out",
        accelerator: None,
        event_name: Some(MENU_LOGOUT_EVENT),
        native_handler: None,
    },
    MenuAction {
        id: MENU_CLOSE_WINDOW_ID,
        label: "Close Window",
        accelerator: Some("CmdOrCtrl+W"),
        event_name: None,
        native_handler: Some(NativeMenuHandler::CloseWindow),
    },
    MenuAction {
        id: MENU_QUIT_ID,
        label: "Quit",
        accelerator: Some("CmdOrCtrl+Q"),
        event_name: None,
        native_handler: Some(NativeMenuHandler::Quit),
    },
];

fn find_menu_action(id: &str) -> Option<&'static MenuAction> {
    MENU_ACTIONS.iter().find(|action| action.id == id)
}

fn require_menu_action(id: &'static str) -> &'static MenuAction {
    find_menu_action(id).expect("desktop menu action must exist")
}

fn build_action_item<R: Runtime>(app: &App<R>, action: &MenuAction) -> tauri::Result<MenuItem<R>> {
    let mut item = MenuItemBuilder::with_id(action.id, action.label);

    if let Some(accelerator) = action.accelerator {
        item = item.accelerator(accelerator);
    }

    item.build(app)
}

#[cfg(target_os = "macos")]
fn build_macos_menu<R: Runtime>(app: &App<R>) -> tauri::Result<Menu<R>> {
    let app_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Teak".to_string());
    let about_label = format!("About {app_name}");
    let settings_item = build_action_item(app, require_menu_action(MENU_SETTINGS_ID))?;
    let check_updates_item = build_action_item(app, require_menu_action(MENU_CHECK_UPDATES_ID))?;
    let logout_item = build_action_item(app, require_menu_action(MENU_LOGOUT_ID))?;

    let about_item = PredefinedMenuItem::about(
        app,
        Some(&about_label),
        Some(AboutMetadata {
            name: Some(app_name.clone()),
            version: Some(app.package_info().version.to_string()),
            copyright: app.config().bundle.copyright.clone(),
            authors: app
                .config()
                .bundle
                .publisher
                .clone()
                .map(|publisher| vec![publisher]),
            icon: app.default_window_icon().cloned(),
            ..Default::default()
        }),
    )?;
    let services_item = PredefinedMenuItem::services(app, None)?;
    let hide_item = PredefinedMenuItem::hide(app, None)?;
    let hide_others_item = PredefinedMenuItem::hide_others(app, None)?;
    let show_all_item = PredefinedMenuItem::show_all(app, None)?;
    let quit_item = PredefinedMenuItem::quit(app, None)?;

    let app_submenu = Submenu::with_items(
        app,
        app_name,
        true,
        &[
            &about_item,
            &settings_item,
            &check_updates_item,
            &PredefinedMenuItem::separator(app)?,
            &services_item,
            &PredefinedMenuItem::separator(app)?,
            &hide_item,
            &hide_others_item,
            &show_all_item,
            &PredefinedMenuItem::separator(app)?,
            &logout_item,
            &quit_item,
        ],
    )?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_submenu = Submenu::with_id_and_items(
        app,
        tauri::menu::WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_submenu =
        Submenu::with_id_and_items(app, tauri::menu::HELP_SUBMENU_ID, "Help", true, &[])?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&edit_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()
}

#[cfg(not(target_os = "macos"))]
fn build_fallback_menu<R: Runtime>(app: &App<R>) -> tauri::Result<Menu<R>> {
    let logout_item = build_action_item(app, require_menu_action(MENU_LOGOUT_ID))?;
    let close_window_item = build_action_item(app, require_menu_action(MENU_CLOSE_WINDOW_ID))?;
    let quit_item = build_action_item(app, require_menu_action(MENU_QUIT_ID))?;
    let settings_item = build_action_item(app, require_menu_action(MENU_SETTINGS_ID))?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&logout_item)
        .separator()
        .item(&close_window_item)
        .item(&quit_item)
        .build()?;
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&settings_item)
        .build()?;

    MenuBuilder::new(app)
        .item(&file_submenu)
        .item(&edit_submenu)
        .build()
}

fn handle_menu_action<R: Runtime>(app: &tauri::AppHandle<R>, action: &MenuAction) {
    if let Some(event_name) = action.event_name {
        let _ = app.emit(event_name, ());
    }

    match action.native_handler {
        Some(NativeMenuHandler::CloseWindow) => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        Some(NativeMenuHandler::Quit) => {
            app.exit(0);
        }
        None => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            let menu = build_macos_menu(app)?;
            #[cfg(not(target_os = "macos"))]
            let menu = build_fallback_menu(app)?;

            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if let Some(action) = find_menu_action(event.id().as_ref()) {
                handle_menu_action(app, action);
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn menu_action_ids_are_unique() {
        let ids = MENU_ACTIONS
            .iter()
            .map(|action| action.id)
            .collect::<HashSet<_>>();

        assert_eq!(ids.len(), MENU_ACTIONS.len());
    }

    #[test]
    fn frontend_event_actions_match_expected_channels() {
        assert_eq!(
            require_menu_action(MENU_SETTINGS_ID).event_name,
            Some(MENU_SETTINGS_EVENT)
        );
        assert_eq!(
            require_menu_action(MENU_CHECK_UPDATES_ID).event_name,
            Some(MENU_CHECK_UPDATES_EVENT)
        );
        assert_eq!(
            require_menu_action(MENU_LOGOUT_ID).event_name,
            Some(MENU_LOGOUT_EVENT)
        );
    }

    #[test]
    fn close_and_quit_actions_use_native_handlers() {
        assert_eq!(
            require_menu_action(MENU_CLOSE_WINDOW_ID).native_handler,
            Some(NativeMenuHandler::CloseWindow)
        );
        assert_eq!(
            require_menu_action(MENU_QUIT_ID).native_handler,
            Some(NativeMenuHandler::Quit)
        );
    }
}
