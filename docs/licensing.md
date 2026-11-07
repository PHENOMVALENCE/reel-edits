# Licensing and media policy

The [MIT license](../LICENSE) applies to this repository's source and documentation. Runtime dependencies, binaries, fonts, music, stock media, user uploads and reference content retain their own terms.

- Review the exact [FFmpeg build and linked components](https://ffmpeg.org/legal.html) before distributing a worker image. FFmpeg's default license is LGPL, while enabling GPL components changes the applicable terms. Review obligations for the selected build, including the chosen H.264 encoder and any redistribution. Record component versions, build flags, notices, and source-offer obligations alongside a distributable image.
- Remotion is used under its [Free License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md), which covers individuals, non-profits and for-profit companies with up to 3 employees. The app passes `licenseKey: "free-license"` to the in-browser renderer. If the operating entity grows beyond that, buy a company license and replace the key. The renderer sends an anonymous usage event (the site's origin, not your media) to Remotion after each export.
- Vercel's Hobby plan is for personal, non-commercial use. A commercial deployment needs the Pro plan.
- The Montserrat font in `public/fonts` is bundled under the [SIL Open Font License](../public/fonts/Montserrat-OFL.txt).
- Process and export footage, fonts and music only within the scope of the permissions granted. Record source, attribution and permitted use for assets bundled with the app or committed as fixtures.
- Keep social URLs as reference links and platform embeds. Public visibility does not grant permission to download a clip, submit it for model analysis, or reuse its soundtrack. Analyze uploaded references only when authorized and keep their content out of exports by default.
- In the phone app, media stays on the device: files are read locally, and nothing is uploaded. The only data that leaves the phone is what you choose to share to the Claude app (the contact sheet and prompt).
- Keep project media private. Disclose when selected frames or audio are sent to a model provider and enforce project-level access, deletion, and retention rules for originals and derived media.
