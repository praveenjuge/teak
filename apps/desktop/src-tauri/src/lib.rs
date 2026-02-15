#[tauri::command]
fn placeholder() -> String {
    "ready".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::Builder::new().build())
        .invoke_handler(tauri::generate_handler![placeholder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
