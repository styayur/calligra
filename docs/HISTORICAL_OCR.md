# Historical extraction and OCR evaluation

Use the original scan, choose a text region and review each crop against the original before confirming a transcription. Regular inscription panels can be divided into rows and columns. For connected kana, use one region and confirm the full sequence. The personal library retains the scan digest, pixel coordinates, processing settings and transcription. The projection and guided grid tools produce unlabelled suggestions. Choose Original to preserve the crop pixels, or preview the mask before using it.

## Routing by material

| Material | Local Calligra workflow | Research candidate |
| --- | --- | --- |
| Modern printed Chinese or Japanese | Install the corresponding Tesseract data and ask for single-character suggestions. Scores under 65 or characters outside the model's expected script return no text. | PaddleOCR detection plus script-specific recognizers for page or line input |
| Classical Japanese books | Review the original and draw or refine boxes; optionally record connected kana as a group. | Local NDL Kotenseki OCR-Lite. CODH RURI can be evaluated on publicly shareable IIIF pages. |
| Chinese rubbings | Start from the inscription region. Use the grid for regular rows and columns, then correct each box and label. | Train or evaluate layout and recognition separately on rights-cleared rubbings using Kraken/eScriptorium. |
| Cursive handwriting | Review connected marks, split or merge boxes, and confirm the sequence manually. | Kraken/eScriptorium with a verified model for the source, or primary-source benchmarks such as CalligraphicOCR. |
| Modern and historical Korean | Manual proofreading and crop entry. | Script-specific modern printed models. Historical Hanja and Jamo require separate references and evaluations. |

## Upstream options and rights

| Project | Input, output and operation | Rights assessment |
| --- | --- | --- |
| [CODH KuroNet / RURI](https://codh.rois.ac.jp/kuronet/) | Logged-in IIIF page recognition. The service now runs RURI. Outputs can inform review of coordinates and transcriptions. | CODH's sample corpus terms are CC BY-SA 4.0. A separate grant is needed for model redistribution. Calligra does not transmit scans to this service. |
| [NDL Kotenseki OCR-Lite](https://github.com/ndl-lab/ndlkotenocr-lite/tree/1.4.3) | CPU offline page layout and line recognition. The v1.4.3 Windows ZIP is about 153 MB, including its runtime. The locator and recognition ONNX files total about 83 MB. | NDL publishes the application under CC BY 4.0 with separate dependency notices. Review the exact model and named training sources before redistribution. |
| [Kraken](https://github.com/mittagessen/kraken) and [eScriptorium](https://gitlab.com/scripta/escriptorium) | Local or self-hosted trainable layout, reading order and transcription. Model choice determines download size. Output formats include ALTO and PAGE XML. | Kraken code is Apache-2.0. Obtain each model's own licence and training-data record. No model was selected for bundling. |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Local detection and recognition with CPU/GPU backends. Deployment size varies by recognizer and backend. | Framework is Apache-2.0. Audit the specific recognizer, weights and provenance independently. |
| [Multi-Stage-KCR](https://github.com/RuiyangJu/Multi-Stage-KCR) | Whole-page detection, crops, classification, reading order and an optional network-based correction stage. Authors report separate real and synthetic metrics. | The stated CC BY-SA 4.0 terms cover the dataset. Review detector checkpoints, the Metom classifier and code independently. |

No new OCR weights are included. The benchmark baseline is 0/20 on historical CODH crops and 0/6 automatic original-page localizations at IoU ≥ 0.5 across the two baseline fixtures. The original-page labels are partial. An unmatched proposal cannot be confidently counted as a false positive. Keep results from manually guided regions separate from whole-page automation.
