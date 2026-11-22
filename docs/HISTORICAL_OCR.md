# Historical extraction and OCR evaluation

Use the original scan, choose a text region and review each crop against the original before confirming a transcription. Regular inscription panels can be divided into rows and columns. For connected kana, use one region and confirm the full sequence. The personal library retains the scan digest, pixel coordinates, processing settings and transcription. The projection and guided grid tools produce unlabelled suggestions. Choose Original to preserve the crop pixels, or preview the mask before using it.

## Routing by material

| Material | Local Calligra workflow | Research candidate |
| --- | --- | --- |
| Modern printed Chinese or Japanese | Install the corresponding Tesseract data and ask for single-character suggestions. Scores under 65 or characters outside the model's expected script return no text. | PaddleOCR detection plus script-specific recognizers for page or line input |
| Classical Japanese books | Review the original and draw or refine boxes; optionally record connected kana as a group. | Local NDL Kotenseki OCR-Lite. CODH RURI can be evaluated on publicly shareable IIIF pages. |
| Chinese rubbings | Start from the inscription region. Use the grid for regular rows and columns, then correct each box and label. | Train or evaluate layout and recognition separately on rights-cleared rubbings using Kraken/eScriptorium. |
| Cursive handwriting | Review connected marks, split or merge boxes, and confirm the sequence manually. | Kraken/eScriptorium with a verified model for the source, or primary-source benchmarks such as CalligraphicOCR. |
| Korean | Modern printed Hangul can use a separately installed `kor` Tesseract model. Historical Hanja and Jamo remain in the manual review workflow. | Historical sources require separate references and evaluations. |

## Upstream options and rights

| Project | Input, output and operation | Rights assessment |
| --- | --- | --- |
| [CODH KuroNet / RURI](https://codh.rois.ac.jp/kuronet/) | Logged-in IIIF page recognition. The service now runs RURI. Outputs can inform review of coordinates and transcriptions. | CODH's sample corpus terms are CC BY-SA 4.0. A separate grant is needed for model redistribution. Calligra does not transmit scans to this service. |
| [NDL Kotenseki OCR-Lite](https://github.com/ndl-lab/ndlkotenocr-lite/tree/1.4.3) | CPU offline page layout and line recognition. The v1.4.3 Windows ZIP is about 153 MB, including its runtime. The locator and recognition ONNX files total about 83 MB. | NDL publishes the application under CC BY 4.0 with separate dependency notices. Review the exact model and named training sources before redistribution. |
| [Kraken](https://github.com/mittagessen/kraken) and [eScriptorium](https://gitlab.com/scripta/escriptorium) | Local or self-hosted trainable layout, reading order and transcription. Model choice determines download size. Output formats include ALTO and PAGE XML. | Kraken code is Apache-2.0. Obtain each model's own licence and training-data record. No model was selected for bundling. |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Local detection and recognition with CPU/GPU backends. Deployment size varies by recognizer and backend. | Framework is Apache-2.0. Audit the specific recognizer, weights and provenance independently. |
| [Multi-Stage-KCR](https://github.com/RuiyangJu/Multi-Stage-KCR) | Whole-page detection, crops, classification, reading order and an optional network-based correction stage. Authors report separate real and synthetic metrics. | The stated CC BY-SA 4.0 terms cover the dataset. Review detector checkpoints, the Metom classifier and code independently. |

No new OCR weights are included. The benchmark baseline is 0/20 on historical CODH crops and 0/6 automatic original-page localizations at IoU ≥ 0.5 across the two baseline fixtures. The original-page labels are partial. An unmatched proposal cannot be confidently counted as a false positive. Keep results from manually guided regions separate from whole-page automation.

### Original-page results

| Fixture | Whole-page projection at IoU ≥ 0.5 | Editor-guided grid | Manual crop reopened and pixels checked |
| --- | ---: | ---: | ---: |
| CODH ぢぐち page 2 | 0/3 | — | 3/3 |
| National Palace Museum, Wang epitaph heading | 0/3 | 3/3 (IoU 0.7133–0.8202) | 3/3 |
| CODH ぢぐち page 7, held out from positioning changes | 0/2 | — | 2/2 |

On the same three images, the optional NDL 1.4.3 CPU command produced 10, 4 and 10 lines, respectively. It covered the labelled character centers in 3/3, 0/3 and 2/2 cases. Each classically printed label was present somewhere in its intersecting predicted line. These counts measure line coverage and character presence. They cannot be compared directly with exact character transcription or character IoU. The epitaph did not produce suitable text-line proposals.

Retesting the same 20 CODH crops with tesserocr 2.13.0 and tessdata_fast 4.1.0 yielded 0/20 exact hits, with five incorrect suggestions and 15 abstentions. The two manually boxed holdout samples yielded 0/2, one incorrect suggestion and one abstention. All 22 historical labels required manual entry or correction. On synthetic controls, the engine yielded 3/8 exact printed Chinese labels and 8/8 exact Hangul labels. These small controls exercise the local model route.

The evaluated NDL source was `008c09838cfefec8fdcac72982d5d54a5051aefc`. Model files and SHA-256 digests are recorded below for reproduction. Run its upstream `src/ocr.py --sourcedir <fixture-dir> --output <existing-results-dir> --device cpu`. Then run `python scripts/evaluate_ndl_layout.py --ndl-results <results-dir>`.

| NDL model | SHA-256 |
| --- | --- |
| `parseq-ndl-32x384-tiny-10.onnx` | `fd75b2c435d053fab9f9e563393ee5b6654a41434b2358b50fb63498a2c85b79` |
| `rtmdet-s-1280x1280.onnx` | `f46267754d406431f6e035f9e20b8552af8ff1ab5ca13bcac8f4b1abbd02090c` |

| Optional tessdata_fast 4.1.0 model | SHA-256 |
| --- | --- |
| `chi_tra.traineddata` | `529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b` |
| `jpn.traineddata` | `1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d` |
| `kor.traineddata` | `6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2` |
