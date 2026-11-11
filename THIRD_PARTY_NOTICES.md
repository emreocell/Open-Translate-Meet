# Third-party notices

Application code is **Apache-2.0** (see `LICENSE` and `NOTICE`). Dependencies retain their own licenses.
`LICENSES/` contains the upstream texts and notices. Do not remove them from
redistributed copies. A license choice for this application does not relicense
its dependencies, a provider service, or a trademark.

| Component | Version | License | Distribution |
| --- | --- | --- | --- |
| LiveKit browser SDK | 2.23.0 | Apache-2.0 | `assets/js/livekit-client.umd.js` |
| @ricky0123/vad-web | 0.0.31 | ISC | VAD bundle and audio worklet |
| Silero VAD v5 | bundled by VAD 0.0.31 | MIT | `silero_vad_v5.onnx` |
| ONNX Runtime Web | 1.29.0 | MIT and upstream third-party notices | WebAssembly runtime and loader |
| ONNX code inside the VAD bundle | 1.22.0, as identified by upstream bundle notice | MIT | Included in the upstream VAD bundle |
| PHPMailer | 7.2.0, locked by Composer | LGPL-2.1-only | Installed into `vendor/`; no production website dependency |
| Buf Protobuf and Google-origin varint code | 1.10.1 in npm dependency tree | Apache-2.0 AND BSD-3-Clause | Covered by additional upstream notices |
| Playwright / Playwright Core | 1.65.0 | Apache-2.0 and upstream notices | Development-only browser regression tooling; not deployed browser assets |

Upstream sources:

- <https://github.com/livekit/client-sdk-js/tree/v2.23.0>
- <https://github.com/ricky0123/vad>
- <https://github.com/snakers4/silero-vad>
- <https://github.com/microsoft/onnxruntime/tree/v1.29.0>
- <https://github.com/PHPMailer/PHPMailer/tree/v7.2.0>
- <https://github.com/bufbuild/protobuf-es/tree/v1.10.1>
- <https://github.com/microsoft/playwright/tree/v1.65.0>

`LICENSES/npm-dependencies.txt` inventories license texts shipped with the pinned
npm installation. ONNX Runtime, VAD and Buf have additional dedicated upstream
license files because their npm archives omit some root notices. `guid-typescript`
1.0.9 declares ISC in its package metadata but does not ship a separate license
file; it is a development dependency of the upstream ONNX package and is not
copied as a separate runtime asset. Its source and package metadata remain at
<https://github.com/NicolasDeveloper/guid-typescript>. The package tree is not a
claim that every installed module is embedded in the browser bundle.

`assets/vendor-manifest.json` records the exact bytes, versions and SHA-256 hashes
of the eight runtime assets. The original model and WebAssembly binaries were
matched against upstream packages before adding this manifest. To reproduce:

```sh
npm ci --ignore-scripts
npm run vendor:sync
npm run vendor:verify
```

After changing a dependency, update its pinned version, regenerate assets,
review upstream licenses and test the actual browser bundle. `npm audit` checks
package advisories; it does not replace source or runtime review.

## Fonts, artwork and brands

The application uses platform system fonts, with no font download or external
font service. No proprietary fonts or company artwork are distributed. An operator can supply their
own licensed logo and favicon through configuration.

The license texts of MIT, ISC, BSD, Apache-2.0 and the unmodified separately
installed LGPL PHPMailer are compatible with the chosen application license in
this distribution. Preserve their notices and the LGPL user's ability to replace
the library. FFmpeg is a system dependency; its build options and corresponding
LGPL/GPL obligations depend on the distribution you install. Container images
also contain their own operating-system and PHP license notices.

