/**
 * Per-icon deep imports instead of the @phosphor-icons/react barrel.
 * The barrel re-exports ~1500 icon modules, which stalls Vite's transform
 * step for minutes; deep imports keep the module graph at exactly the
 * icons the app uses.
 */
export { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
export { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
export { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
export { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
export { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
export { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar";
export { Circle } from "@phosphor-icons/react/dist/csr/Circle";
export { Crosshair } from "@phosphor-icons/react/dist/csr/Crosshair";
export { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
export { Eye } from "@phosphor-icons/react/dist/csr/Eye";
export { EyeSlash } from "@phosphor-icons/react/dist/csr/EyeSlash";
export { FilePlus } from "@phosphor-icons/react/dist/csr/FilePlus";
export { FilmStrip } from "@phosphor-icons/react/dist/csr/FilmStrip";
export { FloppyDisk } from "@phosphor-icons/react/dist/csr/FloppyDisk";
export { House } from "@phosphor-icons/react/dist/csr/House";
export { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
export { Moon } from "@phosphor-icons/react/dist/csr/Moon";
export { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
export { Play } from "@phosphor-icons/react/dist/csr/Play";
export { Polygon } from "@phosphor-icons/react/dist/csr/Polygon";
export { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
export { Square } from "@phosphor-icons/react/dist/csr/Square";
export { Sun } from "@phosphor-icons/react/dist/csr/Sun";
export { Timer } from "@phosphor-icons/react/dist/csr/Timer";
export { Trash } from "@phosphor-icons/react/dist/csr/Trash";
export { UploadSimple } from "@phosphor-icons/react/dist/csr/UploadSimple";
