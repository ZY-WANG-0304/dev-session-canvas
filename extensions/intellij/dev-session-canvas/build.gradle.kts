import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.17.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        create(
            providers.gradleProperty("platformType"),
            providers.gradleProperty("platformVersion")
        )
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

val buildWebview by tasks.registering(Exec::class) {
    workingDir = projectDir
    commandLine("node", "scripts/build-webview.mjs")
    inputs.files(
        file("src/main/webview/main.tsx"),
        file("src/main/webview/styles.css"),
        file("scripts/build-webview.mjs")
    )
    outputs.dir(layout.buildDirectory.dir("generated/webview"))
}

val testWebviewBundle by tasks.registering(Exec::class) {
    dependsOn(buildWebview)
    workingDir = projectDir
    commandLine("node", "scripts/test-webview-bundle.mjs")
    inputs.files(
        layout.buildDirectory.file("generated/webview/webview.js"),
        layout.buildDirectory.file("generated/webview/webview.css")
    )
}

tasks.processResources {
    dependsOn(buildWebview)
    from(layout.buildDirectory.dir("generated/webview")) {
        into("webview")
    }
}

tasks.named("test") {
    dependsOn(testWebviewBundle)
}

intellijPlatform {
    pluginConfiguration {
        id = "com.devsessioncanvas.canvas"
        name = "Dev Session Canvas"
        version = providers.gradleProperty("pluginVersion")
        description = "Internal IntelliJ Platform proof of concept for Dev Session Canvas."
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = providers.gradleProperty("pluginUntilBuild")
        }
        vendor {
            name = "Dev Session Canvas"
            url = "https://github.com/ZY-WANG-0304/dev-session-canvas"
        }
    }
}
