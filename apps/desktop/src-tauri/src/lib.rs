use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::Emitter;

const MENU_FILE_LOGOUT_ID: &str = "file.logout";
const MENU_EDIT_PREFERENCES_ID: &str = "edit.preferences";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let file_submenu = SubmenuBuilder::new(app, "File")
                .text(MENU_FILE_LOGOUT_ID, "Logout")
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
            MENU_EDIT_PREFERENCES_ID => {
                let _ = app.emit("desktop://menu/preferences", ());
            }
            _ => {}
        })
        .plugin(tauri_plugin_opener::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
