use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{Emitter, Manager, Runtime};

const MENU_APP_LOGOUT_ID: &str = "app.logout";
const MENU_APP_SETTINGS_ID: &str = "app.settings";
const MENU_APP_CHECK_UPDATES_ID: &str = "app.check_for_updates";

const MENU_FILE_LOGOUT_ID: &str = "file.logout";
const MENU_FILE_CLOSE_WINDOW_ID: &str = "file.close_window";
const MENU_FILE_QUIT_ID: &str = "file.quit";
const MENU_EDIT_SETTINGS_ID: &str = "edit.settings";

#[cfg(target_os = "macos")]
fn build_macos_menu<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<Menu<R>> {
    let app_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Teak".to_string());
    let about_label = format!("About {app_name}");
    let check_updates_item =
        MenuItemBuilder::with_id(MENU_APP_CHECK_UPDATES_ID, "Check for Updates...").build(app)?;
    let settings_item = MenuItemBuilder::with_id(MENU_APP_SETTINGS_ID, "Settings...")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let logout_item = MenuItemBuilder::with_id(MENU_APP_LOGOUT_ID, "Log Out").build(app)?;

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
fn build_fallback_menu<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<Menu<R>> {
    let close_window_item = MenuItemBuilder::with_id(MENU_FILE_CLOSE_WINDOW_ID, "Close Window")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let quit_item = MenuItemBuilder::with_id(MENU_FILE_QUIT_ID, "Quit")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let settings_item = MenuItemBuilder::with_id(MENU_EDIT_SETTINGS_ID, "Settings...")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .text(MENU_FILE_LOGOUT_ID, "Logout")
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
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_APP_LOGOUT_ID | MENU_FILE_LOGOUT_ID => {
                let _ = app.emit("desktop://menu/logout", ());
            }
            MENU_APP_SETTINGS_ID | MENU_EDIT_SETTINGS_ID => {
                let _ = app.emit("desktop://menu/settings", ());
            }
            MENU_APP_CHECK_UPDATES_ID => {
                let _ = app.emit("desktop://menu/check-for-updates", ());
            }
            MENU_FILE_CLOSE_WINDOW_ID => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.close();
                }
            }
            MENU_FILE_QUIT_ID => {
                app.exit(0);
            }
            _ => {}
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
