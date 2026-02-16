use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri::Manager;

const MENU_FILE_LOGOUT_ID: &str = "file.logout";
const MENU_FILE_CLOSE_WINDOW_ID: &str = "file.close_window";
const MENU_FILE_QUIT_ID: &str = "file.quit";
const MENU_EDIT_PREFERENCES_ID: &str = "edit.preferences";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let close_window_item = MenuItemBuilder::with_id(
                MENU_FILE_CLOSE_WINDOW_ID,
                "Close Window",
            )
            .accelerator("CmdOrCtrl+W")
            .build(app)?;

            let quit_item = MenuItemBuilder::with_id(MENU_FILE_QUIT_ID, "Quit")
                .accelerator("CmdOrCtrl+Q")
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
                .text(MENU_EDIT_PREFERENCES_ID, "Preferences")
                .build()?;
            let menu = MenuBuilder::new(app)
                .item(&file_submenu)
                .item(&edit_submenu)
                .build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_FILE_LOGOUT_ID => {
                let _ = app.emit("desktop://menu/logout", ());
            }
            MENU_FILE_CLOSE_WINDOW_ID => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.close();
                }
            }
            MENU_FILE_QUIT_ID => {
                app.exit(0);
            }
            MENU_EDIT_PREFERENCES_ID => {
                let _ = app.emit("desktop://menu/preferences", ());
            }
            _ => {}
        })
        .plugin(tauri_plugin_opener::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
