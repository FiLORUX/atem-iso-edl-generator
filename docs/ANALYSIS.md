# Open‑Source ISO EDL Logger
### Real‑time vision‑mixer cut logging → broadcast‑grade EDL/XML for post‑production

## Overview

This project aims to deliver an **open, modern, broadcast‑robust tool** that logs live cut events from a vision mixer (e.g. ATEM, Ross) in real time and automatically generates **standardised EDL/XML files** based on ISO recordings.

The goal is to reconstruct the live edit accurately in **any NLE** (DaVinci Resolve, Adobe Premiere Pro, Avid, etc.) — without image analysis, without heuristics, and without proprietary timelines.

Functionally, the project can be seen as a **professional, vendor‑agnostic equivalent to ATEM Mini ISO**, designed for:

- larger ATEM systems  
- external ISO recorders (HyperDeck, Ki Pro, vMix, etc.)  
- high‑grade OB and studio environments  

The project is **fully open source**.

---

## Design Principles

- Event‑driven logging (not video analysis)  
- External ISO recording (devices do what they do best)  
- Single, coherent timecode domain  
- Standards‑based edit formats  
- Minimal complexity, maximum determinism  
- Low long‑term maintenance cost  

---

## Core Features (Target Scope)

- Real‑time logging of all live cuts  
- Accurate mapping of each cut to **source + timecode**  
- Automatic generation of:
  - CMX3600 EDL  
  - XML (Resolve / Premiere / FCP‑compatible)  
- Direct import into editing systems without manual relinking  
- Simple, modern web‑based GUI  
- Optional headless mode for OB / server operation  

---

## Supported Mixers – Strategy

### Blackmagic ATEM

- Direct connection via ATEM control protocol  
- Listens to **Program bus state changes**  
- Recommended libraries:
  - Python: `PyATEMMax`  
  - Node.js: `atem‑connection`  

### Ross / Grass Valley / Other Professional Mixers

- **TSL Tally Protocol (v3.1 / v5)** as a universal abstraction  
- Enables mixer‑agnostic cut detection  

### Bitfocus Companion (Optional)

- Possible middleware for unsupported devices  
- Not primary architecture (additional dependency chain)  
- Potential future integration path  

---

## ISO Recording & Recorder Integration

The project **does not record video itself** (intentional design decision).  
It integrates with existing, proven recorders.

### Blackmagic HyperDeck

- Ethernet control protocol  
- Real‑time access to:
  - record state  
  - running timecode  
  - clip / file names  
- Recommended primary reference device  

### vMix MultiCorder

- HTTP API access  
- Software‑based ISO recording  
- Requires deterministic filename templates  

### AJA Ki Pro

- REST API  
- Record control and metadata access  

### Atomos Devices

- Limited or no public API  
- Typically integrated via LTC / timecode trigger  
- Manual start supported as fallback  

---

## Timecode – The Critical Component

The entire system relies on **a shared, deterministic timebase**.

Priority order:

1. External LTC / house timecode  
2. Recorder‑derived timecode (e.g. HyperDeck)  
3. Simultaneous record start with negligible drift  
4. Time‑of‑day filenames (last‑resort fallback)  

Planned features:

- Frame‑offset compensation  
- Selectable master timecode source  
- Explicit framerate handling (25p / 50i / etc.)  

---

## Architecture Overview

```
[ Vision Mixer ]
      |
      |  (ATEM API / TSL)
      v
[ Cut Event Listener ]
      |
      v
[ Central Logger ] -----> [ Timecode Source ]
      |                     (HyperDeck / LTC)
      v
[ Timeline Model ]
      |
      v
[ EDL / XML Exporter ]
```

---

## Edit Formats & NLE Compatibility

- **CMX3600 EDL**
  - Universal, robust, widely supported  
- **FCP7 XML**
  - Readable by DaVinci Resolve and Premiere Pro  

Planned / optional:

- FCPXML  
- AAF (subject to feasibility)  

Primary goal: **direct import with no corrective work**.

---

## Technology Choice – Recommendation

### Suggested MVP Stack

- Python 3.11+  
- `PyATEMMax`  
- Async socket communication (HyperDeck, TSL)  
- Web GUI via FastAPI / Flask + minimal frontend  
- Runs on:
  - macOS  
  - Windows  
  - Linux (including headless systems)  

Rationale:

- Proven in comparable open‑source projects  
- Low conceptual and operational complexity  
- Easy community contribution  
- Stable in broadcast environments  

Node.js is a valid alternative, particularly for Electron or browser‑first GUIs.

---

## Explicitly Out of Scope (Initial Phase)

- In‑process SDI capture via DeckLink  
- ffmpeg‑based ISO recording  
- Software‑based SDI decode  

Reasons:

- High failure impact  
- High maintenance burden  
- Low benefit compared to dedicated hardware  

---

## References & Prior Art

- **ATEM Logger** – Télio Tortay  
  https://github.com/telion/atem‑logger  

- **Multicam Logger (Node.js)** – Franz Wegner  
  https://github.com/FranzWegner/multicam‑logger  

- **ATEM Exporter (Swift, macOS)**  
  https://fcp.co/final‑cut‑pro/articles/2304‑atem‑exporter  

- **Softron Multicam Logger** (commercial)  
  https://softron.tv/products/multicam‑logger  

- **Ross Carbonite – LiveEDL**  
  https://www.rossvideo.com/products‑services/acquisition‑production/production‑switchers/carbonite/  

- **TSL Tally Protocol (v3.1 / v5)**  
  Industry standard for tally / UMD data  

---

## Project Status

- Architecture & design phase  
- Protocol evaluation  
- No production code committed yet  

---

## Contributing

Contributions are welcome:

- protocol adapters  
- recorder integrations  
- EDL / XML test cases  
- documentation  

Please open issues or pull requests.

---

## Licence

TBD  
(Proposed: MIT or GPLv3, depending on desired copyleft scope)

---

## Vision

> A small, deterministic tool that does **one thing** —  
> and does it **perfectly**.

Live production should not punish post‑production.
