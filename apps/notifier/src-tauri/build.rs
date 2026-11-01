use std::{env, path::PathBuf, process::Command};
fn main() {
    println!("cargo:rerun-if-changed=native/Notifications.swift");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
        let arch = if env::var("CARGO_CFG_TARGET_ARCH").unwrap() == "aarch64" {
            "arm64"
        } else {
            "x86_64"
        };
        let status = Command::new("xcrun")
            .args([
                "swiftc",
                "-parse-as-library",
                "-emit-library",
                "-static",
                "-O",
                "-target",
                &format!("{arch}-apple-macosx11.0"),
                "-module-name",
                "DSCNotifications",
                "native/Notifications.swift",
                "-o",
            ])
            .arg(out.join("libDSCNotifications.a"))
            .status()
            .expect("Xcode Swift toolchain required");
        assert!(
            status.success(),
            "Swift notification adapter failed to compile"
        );
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=DSCNotifications");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=UserNotifications");
        let swift = Command::new("xcrun")
            .args(["--find", "swiftc"])
            .output()
            .expect("locate swiftc");
        assert!(
            swift.status.success(),
            "cannot locate Swift runtime libraries"
        );
        let swift_path = PathBuf::from(String::from_utf8(swift.stdout).unwrap().trim());
        let runtime = swift_path
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("lib/swift/macosx");
        println!("cargo:rustc-link-search=native={}", runtime.display());
        println!("cargo:rustc-link-search=native=/usr/lib/swift");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build()
}
