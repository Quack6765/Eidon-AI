import { useRef, useState, type DragEvent } from "react";

export function useFileDrop(onFiles: (files: File[]) => void) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  const hasFiles = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes("Files");
  return {
    isDraggingFiles,
    fileDropProps: {
      onDragEnter(event: DragEvent<HTMLElement>) {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      },
      onDragOver(event: DragEvent<HTMLElement>) {
        if (hasFiles(event)) event.preventDefault();
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0);
        if (dragDepthRef.current === 0) setIsDraggingFiles(false);
      },
      onDrop(event: DragEvent<HTMLElement>) {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        onFiles(Array.from(event.dataTransfer.files));
      }
    }
  };
}
