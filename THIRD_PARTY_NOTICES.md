# Third-party notices

SanskritLearning uses the components below. Each keeps its own licence. The speech models are not stored in this repository; they are downloaded into `assets/` (sources and checksums in `assets/live-models.json`), and each keeps its licence files in its folder.

## Speech models

| Component | Use | Licence | Source |
|---|---|---|---|
| Parakeet TDT 0.6B v2, int8 (sherpa-onnx export) | Speech recognition | CC BY 4.0 (NVIDIA). Attribution, model card and licence are in the model folder. | Original model: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2. Conversion: https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models. No fine-tuning. |
| Kokoro multi-lang v1.0 (sherpa-onnx export) | Speech synthesis | Apache 2.0. Its LICENSE and README are in the model folder. | Original model: https://huggingface.co/hexgrad/Kokoro-82M. Conversion: https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models; setup downloads it from the converter's Hugging Face copy, https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_0 (revision 7e9b67b). |
| eSpeak NG data (inside the Kokoro folder, `espeak-ng-data`) | Phonemization for Kokoro | GPL-3.0 | https://github.com/espeak-ng/espeak-ng |
| Silero VAD v6.2.3 (`silero_vad.onnx`) | Speech segmenting (finding where speech starts and ends), run by sherpa-onnx | MIT, Copyright (c) 2020-present Silero Team. The licence text is in `assets/models/silero-vad/LICENSE`. | https://github.com/snakers4/silero-vad (tag v6.2.3, commit 5cd7945) |
| Su-śrotā Sanskrit ASR v13b, ONNX int8 | Sanskrit dictation and pronunciation checking | The ONNX export is declared Apache 2.0; the model card of the original asks users to observe the licence of its base model, AI4Bharat IndicConformer (MIT). | Original model: Prof. Prathosh A P, IISc Bengaluru, https://huggingface.co/prathoshap/sushrota-sanskrit-asr. ONNX export: https://huggingface.co/gnumanth/sushrota-sanskrit-asr-onnx (revision d320b7a). |
| Indic Parler-TTS, ONNX fp16 (speaker "Aryan") | Sanskrit voice for replies | Apache 2.0 | Original model: AI4Bharat (IIT Madras), https://huggingface.co/ai4bharat/indic-parler-tts. ONNX export: https://huggingface.co/naklitechie/indic-parler-tts-ONNX (revision d4598da). Description tokenizer: https://huggingface.co/google/flan-t5-large (revision 0613663, Apache 2.0). `src/sanskrit/parler.cjs` is written from https://github.com/huggingface/parler-tts (Apache 2.0). |
| DAC 44.1 kHz decoder, ONNX fp16 | Turns Indic Parler-TTS codes into audio | MIT (Descript Audio Codec) | https://github.com/descriptinc/descript-audio-codec. ONNX export: https://huggingface.co/onnx-community/dac_44khz-ONNX (revision c831ed0). |
| Vāgdhenu Sanskrit chant TTS, ONNX q8 (optional, `"sanskritVoice": "vagdhenu"`; not downloaded by setup) | Chanted Sanskrit verse | Apache 2.0 (Vāgdhenu weights), MIT (ONNX export); built on AI4Bharat IndicF5 (MIT) | Original: https://github.com/prathoshap/vagdhenu (IISc Bengaluru). ONNX export: https://huggingface.co/gnumanth/sanskrit-tts-onnx. `src/sanskrit/tts.cjs` is written from Vāgdhenu's own Apache 2.0 method. |

## Libraries

| Component | Version | Licence | Source |
|---|---|---|---|
| sherpa-onnx-node, sherpa-onnx-win-x64 | 1.13.7, 1.13.8 | Apache 2.0 | https://github.com/k2-fsa/sherpa-onnx |
| ONNX Runtime (bundled in sherpa-onnx-win-x64) | — | MIT | https://github.com/microsoft/onnxruntime |
| Koffi | 3.2.1 | MIT | https://github.com/Koromix/koffi |
| onnxruntime-node (runs the Sanskrit models; bundles its own ONNX Runtime and DirectML DLLs) | 1.30.0 | MIT | https://github.com/microsoft/onnxruntime |
| Node.js (official Windows x64 build, downloaded by setup into %LOCALAPPDATA%\SanskritLearning\runtime\node, not stored in this repository) | 24.21.0 | MIT, with the licences of its bundled dependencies in the LICENSE file beside node.exe | https://nodejs.org |

## Test data

| Component | Licence | Source |
|---|---|---|
| NeMo text processing r1.2.0 English test cases (`test/fixtures/nemo-reference`) | Apache 2.0; licence in that folder | https://github.com/NVIDIA/NeMo-text-processing |

## Notes

- The eSpeak NG data carries GPL obligations, so a distribution that includes the Kokoro folder is not an all-permissive distribution. Review the corresponding-source obligations before redistributing the models publicly.
- `test/fixtures/speech-sample.wav` was generated with the bundled Kokoro voice for tests.
