# Security and Trust in Visual Studio Marketplace

> Source: https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace
> Published: June 11, 2025
> Author: Sean, Senior Product Manager

---

In today's fast-paced digital world, keeping the Visual Studio Marketplace secure and trustworthy is extremely important. We know how crucial it is to protect your extensions, so we're always working on new ways to keep things safe. We'd like to share an update on the existing safeguards and upcoming investments that ensure VS Marketplace remains safe and trustworthy.

---

## Protection against malware

To protect you against malware in extensions, we have a multi-step process in place as shown below. Let's walk through these steps:

**Initial Scan**: First things first, we scan all incoming packages for malware using the same advanced tech found in Microsoft Defender and other top antivirus engines. If this static scan finds any malware, the package gets blocked right away and can't enter the Marketplace.

**Rescanning**: We rescan every newly published package shortly after it's published. Sometimes, scanner databases might lag a bit on new malware patterns, so this rescan helps catch anything that might have passed the initial scan.

**Periodic Marketplace-wide Scans**: We also do periodic bulk rescans of all the packages in the Marketplace. New attack vectors pop up all the time, so it's crucial to keep re-scanning extensions to make sure everything stays safe.

**Dynamic detection**: Each incoming VS Code package gets checked for malicious run-time behavior in a sandbox environment. Packages flagged by rescan or dynamic detection are manually reviewed by security engineers to avoid false positives before removing them.

**Community reporting**: We can't rely on automatic detections alone. With the growth of the extension ecosystem, there are more attempts to evade automated malware checks. The Marketplace partners with the community to keep developers safe. Many of you who have spotted suspected malware or abusive extensions (like invasive data collection or sending data to suspicious endpoints), have already reported over 100 extensions this year via the 'Report a concern' link on the extension page. Thank you! Our dedicated support team reviews each report and usually responds within one business day. Reported packages get re-scanned and thoroughly reviewed by security experts.

**Malware Actions**: Whether we find malware through automation or community reporting, we remove it immediately and, if needed, ban the publisher from the Marketplace. You can stay updated on the latest removals by checking out the RemovedPackages page. When we remove VS Code extensions with malware from the Marketplace, they're also blocked in VS Code, which forces the uninstall of existing instances and prevents future installations to protect users from potential harm.

So far this year, we've reviewed 136 extensions for malicious code and removed 110 preventing potential damage. The insights from these reviews help improve our scanning tools and guide future security investments in the VS Marketplace.

---

## Improving developer trust

We keep the extensions and associated content trustworthy by implementing several measures:

**Unusual Metrics Monitoring**: We keep an eye on usage patterns and metrics of extensions to detect any unusual behavior and stop any attempts to spam or game the system.

**Impersonation Prevention**: We use various techniques to prevent impersonation of popular extensions and avoid search confusion. For example, attempts to use names that can be easily mistaken for a popular publisher are automatically prevented.

**Signature Verification**: Marketplace repository signs all VS Code extensions when they're published. By default, the repository signature verification is enforced at install time, which checks the integrity and source of the extension package.

**Higher Bar for Publisher Verification**: We've introduced a higher bar for obtaining trusted publisher badge. If you see a blue checkmark by an extension, it means the publisher had undergone a series of checks by Marketplace team – their domain was verified, their extensions and domain have been in good standing with the community for at least 6 months.

---

## In the works

Here are some things we're working on this quarter:

**Copycats**: We're reviewing extensions that duplicate repository links and logo images for potential impersonation.

**Secret Scanning**: We're adding a mechanism to scan for and prevent the publishing of extensions containing secrets. We're also cleaning up cases that are already present. If leaked, these secrets can compromise the affected extensions and their users. By the way, secret scanning and preventing .env files in packaging were recently released in the vsce tool.

**Publisher vetting**: Strengthening the onboarding process for extension publishers to ensure authenticity and accountability.

---

## On the roadmap

Here is a highlight of future candidates for security investment:

- **Detect and surface security risks**: Identify and inform users of security-sensitive extension behaviors such as obfuscation and remote code execution.
- **Strengthen extension authenticity**: Require publisher-signing for all Microsoft-owned extensions and enable tooling and guidance for third-party publishers to sign their extensions.
- **Enhance trust and transparency**: Improve publisher profiles, reputation indicators, and review systems to provide clearer trust signals to users.
- **Continuously monitor for threats**: Run ongoing scans across the Marketplace registry to detect vulnerabilities.
- **Reduce impersonation risks**: Improve detection mechanisms to prevent impersonation of popular publishers and extensions.

---

## Publisher best practices

As a publisher, these are some best practices you can follow to keep your extension safe and trustworthy:

- **Get verified**: Boost trustworthiness by becoming a verified publisher.
- **Prevent search confusion**: Choose unique publisher and extension display name, and image.
- **Prevent content duplication**: If you start by cloning another open-source extension, make sure to update the repository link and readme content.
- **Avoid obfuscation**: Clean, and non-obfuscated code in extensions is significantly less likely to trigger a false-positive for malware. Obfuscation, particularly in themes and icons, contributes to suspicion and can slow down review process.
- **Include license**: Include license/EULA. Add any necessary notice for 3rd party attribution.
- **Stop secret leaks**: Carefully review the files being packaged for publishing to exclude secrets and non-essential code/content in general. Use the latest version of vsce which has secret scanning capability.
- **Limit access to publisher**: Assign members of the publisher accounts appropriate roles based on the minimum required access. Regularly review existing members and remove users who have left the team, or otherwise no longer need access.

---

## Know before you install extensions!

As a developer, before you install an extension, you can review various aspects of an extension to determine if it's reliable. With these signals Marketplace empowers you to make an informed decision:

- Check Ratings & Reviews for input from other users and Q & A for the level of the publisher's responsiveness.
- Look for Verified Publisher status as an indicator of trustworthiness.
- Consider install/download counts to assess existing user base.
- Follow Repository link for license, security policy and existing bugs.

---

## 对我们申诉的关键启示

1. **周期性重扫机制**：依赖漏洞很可能不是初次发布时触发的，而是后续周期性重扫发现的。可在申诉中说明我们发布时是合规的。

2. **动态行为分析是潜在风险点**：RuntimePersistence 功能会保持进程运行，沙箱动态检测可能对此产生误判。需在申诉中主动解释该功能完全由用户主动开启。

3. **移除率极高**：2025年审查136个、移除110个（约81%），说明这是系统化扫描行为，并非专门针对我们。

4. **非认证发布者审查标准更严**：认证徽章需要6个月以上良好记录，我们4月发布，尚未达到认证门槛，处于审查标准更严格的分类中。

5. **Publisher best practices 对照检查**：
   - ✅ 无代码混淆
   - ✅ 有 LICENSE 文件
   - ❌ 无隐私政策（待补充）
   - ✅ 无 secrets 泄露
   - ✅ 无内容复制
