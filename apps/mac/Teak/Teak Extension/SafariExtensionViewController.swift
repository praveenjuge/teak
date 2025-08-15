//
//  SafariExtensionViewController.swift
//  Teak Extension
//
//  Created by Praveen Juge on 15/08/25.
//

import SafariServices

class SafariExtensionViewController: SFSafariExtensionViewController {
    
    static let shared: SafariExtensionViewController = {
        let shared = SafariExtensionViewController()
        shared.preferredContentSize = NSSize(width:320, height:240)
        return shared
    }()

}
