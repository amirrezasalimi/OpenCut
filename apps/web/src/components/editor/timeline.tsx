"use client";

import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import {
  Scissors,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  Snowflake,
  Copy,
  SplitSquareHorizontal,
  MoreVertical,
  Volume2,
  VolumeX,
  Pause,
  Play,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "../ui/tooltip";
import { useTimelineStore, type TimelineTrack } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useDragClip } from "@/hooks/use-drag-clip";
import { processMediaFiles } from "@/lib/media-processing";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import AudioWaveform from "./audio-waveform";

export function Timeline() {
  // Timeline shows all tracks (video, audio, effects) and their clips.
  // You can drag media here to add it to your project.
  // Clips can be trimmed, deleted, and moved.
  const {
    tracks,
    addTrack,
    addClipToTrack,
    removeTrack,
    toggleTrackMute,
    removeClipFromTrack,
    getTotalDuration,
    selectedClips,
    clearSelectedClips,
    setSelectedClips,
    updateClipTrim,
    undo,
    redo,
  } = useTimelineStore();
  const { mediaItems, addMediaItem } = useMediaStore();
  const {
    currentTime,
    duration,
    seek,
    setDuration,
    isPlaying,
    toggle,
    setSpeed,
    speed,
  } = usePlaybackStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const dragCounterRef = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isInTimeline, setIsInTimeline] = useState(false);

  // Unified context menu state
  const [contextMenu, setContextMenu] = useState<{
    type: "track" | "clip";
    trackId: string;
    clipId?: string;
    x: number;
    y: number;
  } | null>(null);

  // Marquee selection state
  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    active: boolean;
    additive: boolean;
  } | null>(null);

  // Playhead scrubbing state
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  // Update timeline duration when tracks change
  useEffect(() => {
    const totalDuration = getTotalDuration();
    setDuration(Math.max(totalDuration, 10)); // Minimum 10 seconds for empty timeline
  }, [tracks, setDuration, getTotalDuration]);

  // Close context menu on click elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener("click", handleClick);
      return () => window.removeEventListener("click", handleClick);
    }
  }, [contextMenu]);

  // Keyboard event for deleting selected clips
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedClips.length > 0
      ) {
        selectedClips.forEach(({ trackId, clipId }) => {
          removeClipFromTrack(trackId, clipId);
        });
        clearSelectedClips();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedClips, removeClipFromTrack, clearSelectedClips]);

  // Keyboard event for undo (Cmd+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo]);

  // Keyboard event for redo (Cmd+Shift+Z or Cmd+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo]);

  // Mouse down on timeline background to start marquee
  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && e.button === 0) {
      setMarquee({
        startX: e.clientX,
        startY: e.clientY,
        endX: e.clientX,
        endY: e.clientY,
        active: true,
        additive: e.metaKey || e.ctrlKey || e.shiftKey,
      });
    }
  };

  // Mouse move to update marquee
  useEffect(() => {
    if (!marquee || !marquee.active) return;
    const handleMouseMove = (e: MouseEvent) => {
      setMarquee(
        (prev) => prev && { ...prev, endX: e.clientX, endY: e.clientY }
      );
    };
    const handleMouseUp = (e: MouseEvent) => {
      setMarquee(
        (prev) =>
          prev && { ...prev, endX: e.clientX, endY: e.clientY, active: false }
      );
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [marquee]);

  // On marquee end, select clips in box
  useEffect(() => {
    if (!marquee || marquee.active) return;
    const timeline = timelineRef.current;
    if (!timeline) return;
    const rect = timeline.getBoundingClientRect();
    const x1 = Math.min(marquee.startX, marquee.endX) - rect.left;
    const x2 = Math.max(marquee.startX, marquee.endX) - rect.left;
    const y1 = Math.min(marquee.startY, marquee.endY) - rect.top;
    const y2 = Math.max(marquee.startY, marquee.endY) - rect.top;
    // Validation: skip if too small
    if (Math.abs(x2 - x1) < 5 || Math.abs(y2 - y1) < 5) {
      setMarquee(null);
      return;
    }
    // Clamp to timeline bounds
    const clamp = (val: number, min: number, max: number) =>
      Math.max(min, Math.min(max, val));
    const bx1 = clamp(x1, 0, rect.width);
    const bx2 = clamp(x2, 0, rect.width);
    const by1 = clamp(y1, 0, rect.height);
    const by2 = clamp(y2, 0, rect.height);
    let newSelection: { trackId: string; clipId: string }[] = [];
    tracks.forEach((track, trackIdx) => {
      track.clips.forEach((clip) => {
        const effectiveDuration = clip.duration - clip.trimStart - clip.trimEnd;
        const clipWidth = Math.max(80, effectiveDuration * 50 * zoomLevel);
        const clipLeft = clip.startTime * 50 * zoomLevel;
        const clipTop = trackIdx * 60;
        const clipBottom = clipTop + 60;
        const clipRight = clipLeft + 60; // Set a fixed width for time display
        if (
          bx1 < clipRight &&
          bx2 > clipLeft &&
          by1 < clipBottom &&
          by2 > clipTop
        ) {
          newSelection.push({ trackId: track.id, clipId: clip.id });
        }
      });
    });
    if (newSelection.length > 0) {
      if (marquee.additive) {
        const selectedSet = new Set(
          selectedClips.map((c) => c.trackId + ":" + c.clipId)
        );
        newSelection = [
          ...selectedClips,
          ...newSelection.filter(
            (c) => !selectedSet.has(c.trackId + ":" + c.clipId)
          ),
        ];
      }
      setSelectedClips(newSelection);
    } else if (!marquee.additive) {
      clearSelectedClips();
    }
    setMarquee(null);
  }, [
    marquee,
    tracks,
    zoomLevel,
    selectedClips,
    setSelectedClips,
    clearSelectedClips,
  ]);

  const handleDragEnter = (e: React.DragEvent) => {
    // When something is dragged over the timeline, show overlay
    e.preventDefault();
    // Don't show overlay for timeline clips - they're handled by tracks
    if (e.dataTransfer.types.includes("application/x-timeline-clip")) {
      return;
    }
    dragCounterRef.current += 1;
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();

    // Don't update state for timeline clips - they're handled by tracks
    if (e.dataTransfer.types.includes("application/x-timeline-clip")) {
      return;
    }

    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    // When media is dropped, add it as a new track/clip
    e.preventDefault();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    // Ignore timeline clip drags - they're handled by track-specific handlers
    const hasTimelineClip = e.dataTransfer.types.includes(
      "application/x-timeline-clip"
    );
    if (hasTimelineClip) {
      return;
    }

    const mediaItemData = e.dataTransfer.getData("application/x-media-item");
    if (mediaItemData) {
      // Handle media item drops by creating new tracks
      try {
        const { id, type } = JSON.parse(mediaItemData);
        const mediaItem = mediaItems.find((item) => item.id === id);
        if (!mediaItem) {
          toast.error("Media item not found");
          return;
        }
        // Add to video or audio track depending on type
        const trackType = type === "audio" ? "audio" : "video";
        const newTrackId = addTrack(trackType);
        addClipToTrack(newTrackId, {
          mediaId: mediaItem.id,
          name: mediaItem.name,
          duration: mediaItem.duration || 5,
          startTime: 0,
          trimStart: 0,
          trimEnd: 0,
        });
        toast.success(`Added ${mediaItem.name} to new ${trackType} track`);
      } catch (error) {
        // Show error if parsing fails
        console.error("Error parsing media item data:", error);
        toast.error("Failed to add media to timeline");
      }
    } else if (e.dataTransfer.files?.length > 0) {
      // Handle file drops by creating new tracks
      setIsProcessing(true);
      setProgress(0);
      try {
        const processedItems = await processMediaFiles(
          e.dataTransfer.files,
          (p) => setProgress(p)
        );
        for (const processedItem of processedItems) {
          addMediaItem(processedItem);
          const currentMediaItems = useMediaStore.getState().mediaItems;
          const addedItem = currentMediaItems.find(
            (item) =>
              item.name === processedItem.name && item.url === processedItem.url
          );
          if (addedItem) {
            const trackType =
              processedItem.type === "audio" ? "audio" : "video";
            const newTrackId = addTrack(trackType);
            addClipToTrack(newTrackId, {
              mediaId: addedItem.id,
              name: addedItem.name,
              duration: addedItem.duration || 5,
              startTime: 0,
              trimStart: 0,
              trimEnd: 0,
            });
          }
        }
      } catch (error) {
        // Show error if file processing fails
        console.error("Error processing external files:", error);
        toast.error("Failed to process dropped files");
      } finally {
        setIsProcessing(false);
        setProgress(0);
      }
    }
  };

  const handleSeekToPosition = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickedTime = clickX / (50 * zoomLevel);
    const clampedTime = Math.max(0, Math.min(duration, clickedTime));

    seek(clampedTime);
  };

  const handleTimelineAreaClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      clearSelectedClips();

      // Calculate the clicked time position and seek to it
      handleSeekToPosition(e);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Only zoom if user is using pinch gesture (ctrlKey or metaKey is true)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setZoomLevel((prev) => Math.max(0.1, Math.min(10, prev + delta)));
    }
    // Otherwise, allow normal scrolling
  };

  // --- Playhead Scrubbing Handlers ---
  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsScrubbing(true);
      handleScrub(e);
    },
    [duration, zoomLevel]
  );

  const handleScrub = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const timeline = timelineRef.current;
      if (!timeline) return;
      const rect = timeline.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, Math.min(duration, x / (50 * zoomLevel)));
      setScrubTime(time);
      seek(time); // update video preview in real time
    },
    [duration, zoomLevel, seek]
  );

  useEffect(() => {
    if (!isScrubbing) return;
    const onMouseMove = (e: MouseEvent) => handleScrub(e);
    const onMouseUp = (e: MouseEvent) => {
      setIsScrubbing(false);
      if (scrubTime !== null) seek(scrubTime); // finalize seek
      setScrubTime(null);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isScrubbing, scrubTime, seek, handleScrub]);

  const playheadPosition =
    isScrubbing && scrubTime !== null ? scrubTime : currentTime;

  const dragProps = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  // Action handlers for toolbar
  const handleSplitSelected = () => {
    if (selectedClips.length === 0) {
      toast.error("No clips selected");
      return;
    }
    selectedClips.forEach(({ trackId, clipId }) => {
      const track = tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (clip && track) {
        const splitTime = currentTime;
        const effectiveStart = clip.startTime;
        const effectiveEnd =
          clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
        if (splitTime > effectiveStart && splitTime < effectiveEnd) {
          updateClipTrim(
            track.id,
            clip.id,
            clip.trimStart,
            clip.trimEnd + (effectiveEnd - splitTime)
          );
          addClipToTrack(track.id, {
            mediaId: clip.mediaId,
            name: clip.name + " (split)",
            duration: clip.duration,
            startTime: splitTime,
            trimStart: clip.trimStart + (splitTime - effectiveStart),
            trimEnd: clip.trimEnd,
          });
        }
      }
    });
    toast.success("Split selected clip(s)");
  };

  const handleDuplicateSelected = () => {
    if (selectedClips.length === 0) {
      toast.error("No clips selected");
      return;
    }
    selectedClips.forEach(({ trackId, clipId }) => {
      const track = tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (clip && track) {
        addClipToTrack(track.id, {
          mediaId: clip.mediaId,
          name: clip.name + " (copy)",
          duration: clip.duration,
          startTime:
            clip.startTime +
            (clip.duration - clip.trimStart - clip.trimEnd) +
            0.1,
          trimStart: clip.trimStart,
          trimEnd: clip.trimEnd,
        });
      }
    });
    toast.success("Duplicated selected clip(s)");
  };

  const handleFreezeSelected = () => {
    if (selectedClips.length === 0) {
      toast.error("No clips selected");
      return;
    }
    selectedClips.forEach(({ trackId, clipId }) => {
      const track = tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (clip && track) {
        // Add a new freeze frame clip at the playhead
        addClipToTrack(track.id, {
          mediaId: clip.mediaId,
          name: clip.name + " (freeze)",
          duration: 1, // 1 second freeze frame
          startTime: currentTime,
          trimStart: 0,
          trimEnd: clip.duration - 1,
        });
      }
    });
    toast.success("Freeze frame added for selected clip(s)");
  };

  const handleDeleteSelected = () => {
    if (selectedClips.length === 0) {
      toast.error("No clips selected");
      return;
    }
    selectedClips.forEach(({ trackId, clipId }) => {
      removeClipFromTrack(trackId, clipId);
    });
    clearSelectedClips();
    toast.success("Deleted selected clip(s)");
  };

  // Prevent explorer zooming in/out when in timeline
  useEffect(() => {
    const preventZoom = (e: WheelEvent) => {
      // if (isInTimeline && (e.ctrlKey || e.metaKey)) {
      if (
        isInTimeline &&
        (e.ctrlKey || e.metaKey) &&
        timelineRef.current?.contains(e.target as Node)
      ) {
        e.preventDefault();
      }
    };

    document.addEventListener("wheel", preventZoom, { passive: false });

    return () => {
      document.removeEventListener("wheel", preventZoom);
    };
  }, [isInTimeline]);

  return (
    <div
      className={`h-full flex flex-col transition-colors duration-200 relative ${isDragOver ? "bg-accent/30 border-accent" : ""}`}
      {...dragProps}
      onMouseEnter={() => setIsInTimeline(true)}
      onMouseLeave={() => setIsInTimeline(false)}
      onWheel={handleWheel}
    >
      {/* Toolbar */}
      <div className="border-b flex items-center px-2 py-1 gap-1">
        <TooltipProvider delayDuration={500}>
          {/* Play/Pause Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="text"
                size="icon"
                onClick={toggle}
                className="mr-2"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isPlaying ? "Pause (Space)" : "Play (Space)"}
            </TooltipContent>
          </Tooltip>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Time Display */}
          <div
            className="text-xs text-muted-foreground font-mono px-2"
            style={{ minWidth: "18ch", textAlign: "center" }}
          >
            {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
          </div>

          {/* Test Clip Button - for debugging */}
          {tracks.length === 0 && (
            <>
              <div className="w-px h-6 bg-border mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const trackId = addTrack("video");
                      addClipToTrack(trackId, {
                        mediaId: "test",
                        name: "Test Clip",
                        duration: 5,
                        startTime: 0,
                        trimStart: 0,
                        trimEnd: 0,
                      });
                    }}
                    className="text-xs"
                  >
                    Add Test Clip
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add a test clip to try playback</TooltipContent>
              </Tooltip>
            </>
          )}

          <div className="w-px h-6 bg-border mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={handleSplitSelected}>
                <Scissors className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split clip (S)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon">
                <ArrowLeftToLine className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split and keep left (A)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon">
                <ArrowRightToLine className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split and keep right (D)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon">
                <SplitSquareHorizontal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Separate audio (E)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="text"
                size="icon"
                onClick={handleDuplicateSelected}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate clip (Ctrl+D)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={handleFreezeSelected}>
                <Snowflake className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Freeze frame (F)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={handleDeleteSelected}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete clip (Delete)</TooltipContent>
          </Tooltip>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Speed Control */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Select
                value={speed.toFixed(1)}
                onValueChange={(value) => setSpeed(parseFloat(value))}
              >
                <SelectTrigger className="w-[90px] h-8">
                  <SelectValue placeholder="1.0x" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5x</SelectItem>
                  <SelectItem value="1.0">1.0x</SelectItem>
                  <SelectItem value="1.5">1.5x</SelectItem>
                  <SelectItem value="2.0">2.0x</SelectItem>
                </SelectContent>
              </Select>
            </TooltipTrigger>
            <TooltipContent>Playback Speed</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Timeline Container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Timeline Header with Ruler */}
        <div className="flex border-b bg-background sticky top-0 z-10">
          {/* Track Labels Header */}
          <div className="w-48 flex-shrink-0 bg-muted/30 border-r flex items-center justify-between px-3 py-2">
            <span className="text-sm font-medium text-muted-foreground">
              Tracks
            </span>
            <div className="text-xs text-muted-foreground">
              {zoomLevel.toFixed(1)}x
            </div>
          </div>

          {/* Timeline Ruler */}
          <div className="flex-1 relative overflow-hidden">
            <ScrollArea className="w-full">
              <div
                className="relative h-12 bg-muted/30 cursor-pointer"
                style={{
                  width: `${Math.max(1000, duration * 50 * zoomLevel)}px`,
                }}
                onClick={(e) => {
                  // Calculate the clicked time position and seek to it
                  handleSeekToPosition(e);
                }}
              >
                {/* Time markers */}
                {(() => {
                  // Calculate appropriate time interval based on zoom level
                  const getTimeInterval = (zoom: number) => {
                    const pixelsPerSecond = 50 * zoom;
                    if (pixelsPerSecond >= 200) return 0.1; // Every 0.1s when very zoomed in
                    if (pixelsPerSecond >= 100) return 0.5; // Every 0.5s when zoomed in
                    if (pixelsPerSecond >= 50) return 1; // Every 1s at normal zoom
                    if (pixelsPerSecond >= 25) return 2; // Every 2s when zoomed out
                    if (pixelsPerSecond >= 12) return 5; // Every 5s when more zoomed out
                    if (pixelsPerSecond >= 6) return 10; // Every 10s when very zoomed out
                    return 30; // Every 30s when extremely zoomed out
                  };

                  const interval = getTimeInterval(zoomLevel);
                  const markerCount = Math.ceil(duration / interval) + 1;

                  return Array.from({ length: markerCount }, (_, i) => {
                    const time = i * interval;
                    if (time > duration) return null;

                    const isMainMarker =
                      time % (interval >= 1 ? Math.max(1, interval) : 1) === 0;

                    return (
                      <div
                        key={i}
                        className={`absolute top-0 bottom-0 ${
                          isMainMarker
                            ? "border-l border-muted-foreground/40"
                            : "border-l border-muted-foreground/20"
                        }`}
                        style={{ left: `${time * 50 * zoomLevel}px` }}
                      >
                        <span
                          className={`absolute top-1 left-1 text-xs ${
                            isMainMarker
                              ? "text-muted-foreground font-medium"
                              : "text-muted-foreground/70"
                          }`}
                        >
                          {(() => {
                            const formatTime = (seconds: number) => {
                              const hours = Math.floor(seconds / 3600);
                              const minutes = Math.floor((seconds % 3600) / 60);
                              const secs = seconds % 60;

                              if (hours > 0) {
                                return `${hours}:${minutes.toString().padStart(2, "0")}:${Math.floor(secs).toString().padStart(2, "0")}`;
                              } else if (minutes > 0) {
                                return `${minutes}:${Math.floor(secs).toString().padStart(2, "0")}`;
                              } else if (interval >= 1) {
                                return `${Math.floor(secs)}s`;
                              } else {
                                return `${secs.toFixed(1)}s`;
                              }
                            };
                            return formatTime(time);
                          })()}
                        </span>
                      </div>
                    );
                  }).filter(Boolean);
                })()}

                {/* Playhead in ruler (scrubbable) */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-auto z-10 cursor-ew-resize"
                  style={{ left: `${playheadPosition * 50 * zoomLevel}px` }}
                  onMouseDown={handlePlayheadMouseDown}
                >
                  <div className="absolute top-1 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm" />
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Tracks Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Track Labels */}
          {tracks.length > 0 && (
            <div className="w-48 flex-shrink-0 border-r bg-background overflow-y-auto">
              <div className="flex flex-col">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className="h-[60px] flex items-center px-3 border-b border-muted/30 bg-background group"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        type: "track",
                        trackId: track.id,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    <div className="flex items-center flex-1 min-w-0">
                      <div
                        className={`w-3 h-3 rounded-full flex-shrink-0 ${
                          track.type === "video"
                            ? "bg-blue-500"
                            : track.type === "audio"
                              ? "bg-green-500"
                              : "bg-purple-500"
                        }`}
                      />
                      <span className="ml-2 text-sm font-medium truncate">
                        {track.name}
                      </span>
                    </div>
                    {track.muted && (
                      <span className="ml-2 text-xs text-red-500 font-semibold flex-shrink-0">
                        Muted
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline Tracks Content */}
          <div className="flex-1 relative overflow-hidden">
            <div
              className="w-full h-full overflow-hidden flex"
              ref={timelineRef}
              style={{ position: "relative" }}
            >
              {/* Timeline grid and clips area (with left margin for sifdebar) */}
              <div
                className="relative flex-1"
                style={{
                  height: `${Math.max(200, Math.min(800, tracks.length * 60))}px`,
                  width: `${Math.max(1000, duration * 50 * zoomLevel)}px`,
                }}
                onClick={handleTimelineAreaClick}
                onMouseDown={handleTimelineMouseDown}
              >
                {tracks.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4 mx-auto">
                        <SplitSquareHorizontal className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Drop media here to start
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {tracks.map((track, index) => (
                      <div
                        key={track.id}
                        className="absolute left-0 right-0 border-b border-muted/30"
                        style={{
                          top: `${index * 60}px`,
                          height: "60px",
                        }}
                        // Show context menu on right click
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            type: "track",
                            trackId: track.id,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                      >
                        <TimelineTrackContent
                          track={track}
                          zoomLevel={zoomLevel}
                          setContextMenu={setContextMenu}
                          contextMenu={contextMenu}
                        />
                      </div>
                    ))}

                    {/* Playhead for tracks area (scrubbable) */}
                    {tracks.length > 0 && (
                      <div
                        className="absolute top-0 w-0.5 bg-red-500 pointer-events-auto z-20 cursor-ew-resize"
                        style={{
                          left: `${playheadPosition * 50 * zoomLevel}px`,
                          height: `${tracks.length * 60}px`,
                        }}
                        onMouseDown={handlePlayheadMouseDown}
                      />
                    )}
                  </>
                )}
                {isDragOver && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none backdrop-blur-lg">
                    <div>
                      {isProcessing
                        ? `Processing ${progress}%`
                        : "Drop media here to add to timeline"}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Clean Unified Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-md shadow-md py-1 text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {contextMenu.type === "track" ? (
            // Track context menu
            <>
              <button
                className="flex items-center w-full px-3 py-2 hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                onClick={() => {
                  const track = tracks.find(
                    (t) => t.id === contextMenu.trackId
                  );
                  if (track) toggleTrackMute(track.id);
                  setContextMenu(null);
                }}
              >
                {(() => {
                  const track = tracks.find(
                    (t) => t.id === contextMenu.trackId
                  );
                  return track?.muted ? (
                    <>
                      <Volume2 className="h-4 w-4 mr-2" />
                      Unmute Track
                    </>
                  ) : (
                    <>
                      <VolumeX className="h-4 w-4 mr-2" />
                      Mute Track
                    </>
                  );
                })()}
              </button>
              <div className="h-px bg-border mx-1 my-1" />
              <button
                className="flex items-center w-full px-3 py-2 text-destructive hover:bg-destructive/10 transition-colors text-left"
                onClick={() => {
                  removeTrack(contextMenu.trackId);
                  setContextMenu(null);
                  toast.success("Track deleted");
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Track
              </button>
            </>
          ) : (
            // Clip context menu
            <>
              <button
                className="flex items-center w-full px-3 py-2 hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                onClick={() => {
                  if (contextMenu.clipId) {
                    const track = tracks.find(
                      (t) => t.id === contextMenu.trackId
                    );
                    const clip = track?.clips.find(
                      (c) => c.id === contextMenu.clipId
                    );
                    if (clip && track) {
                      const splitTime = currentTime;
                      const effectiveStart = clip.startTime;
                      const effectiveEnd =
                        clip.startTime +
                        (clip.duration - clip.trimStart - clip.trimEnd);

                      if (
                        splitTime > effectiveStart &&
                        splitTime < effectiveEnd
                      ) {
                        updateClipTrim(
                          track.id,
                          clip.id,
                          clip.trimStart,
                          clip.trimEnd + (effectiveEnd - splitTime)
                        );
                        useTimelineStore.getState().addClipToTrack(track.id, {
                          mediaId: clip.mediaId,
                          name: clip.name + " (split)",
                          duration: clip.duration,
                          startTime: splitTime,
                          trimStart:
                            clip.trimStart + (splitTime - effectiveStart),
                          trimEnd: clip.trimEnd,
                        });
                        toast.success("Clip split successfully");
                      } else {
                        toast.error("Playhead must be within clip to split");
                      }
                    }
                  }
                  setContextMenu(null);
                }}
              >
                <Scissors className="h-4 w-4 mr-2" />
                Split at Playhead
              </button>
              <button
                className="flex items-center w-full px-3 py-2 hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                onClick={() => {
                  if (contextMenu.clipId) {
                    const track = tracks.find(
                      (t) => t.id === contextMenu.trackId
                    );
                    const clip = track?.clips.find(
                      (c) => c.id === contextMenu.clipId
                    );
                    if (clip && track) {
                      useTimelineStore.getState().addClipToTrack(track.id, {
                        mediaId: clip.mediaId,
                        name: clip.name + " (copy)",
                        duration: clip.duration,
                        startTime:
                          clip.startTime +
                          (clip.duration - clip.trimStart - clip.trimEnd) +
                          0.1,
                        trimStart: clip.trimStart,
                        trimEnd: clip.trimEnd,
                      });
                      toast.success("Clip duplicated");
                    }
                  }
                  setContextMenu(null);
                }}
              >
                <Copy className="h-4 w-4 mr-2" />
                Duplicate Clip
              </button>
              <div className="h-px bg-border mx-1 my-1" />
              <button
                className="flex items-center w-full px-3 py-2 text-destructive hover:bg-destructive/10 transition-colors text-left"
                onClick={() => {
                  if (contextMenu.clipId) {
                    removeClipFromTrack(
                      contextMenu.trackId,
                      contextMenu.clipId
                    );
                    toast.success("Clip deleted");
                  }
                  setContextMenu(null);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Clip
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineTrackContent({
  track,
  zoomLevel,
  setContextMenu,
  contextMenu,
}: {
  track: TimelineTrack;
  zoomLevel: number;
  setContextMenu: (
    menu: {
      type: "track" | "clip";
      trackId: string;
      clipId?: string;
      x: number;
      y: number;
    } | null
  ) => void;
  contextMenu: {
    type: "track" | "clip";
    trackId: string;
    clipId?: string;
    x: number;
    y: number;
  } | null;
}) {
  const { mediaItems } = useMediaStore();
  const {
    tracks,
    moveClipToTrack,
    updateClipTrim,
    updateClipStartTime,
    addClipToTrack,
    removeClipFromTrack,
    toggleTrackMute,
    selectedClips,
    selectClip,
    deselectClip,
  } = useTimelineStore();
  const { currentTime } = usePlaybackStore();

  // Mouse-based drag hook
  const {
    isDragging,
    draggedClipId,
    startDrag,
    endDrag,
    getDraggedClipPosition,
    isValidDropTarget,
    timelineRef,
  } = useDragClip(zoomLevel);
  const [isDropping, setIsDropping] = useState(false);
  const [dropPosition, setDropPosition] = useState<number | null>(null);
  const [wouldOverlap, setWouldOverlap] = useState(false);
  const [resizing, setResizing] = useState<{
    clipId: string;
    side: "left" | "right";
    startX: number;
    initialTrimStart: number;
    initialTrimEnd: number;
  } | null>(null);
  const dragCounterRef = useRef(0);
  const [clipMenuOpen, setClipMenuOpen] = useState<string | null>(null);

  // Handle clip deletion
  const handleDeleteClip = (clipId: string) => {
    removeClipFromTrack(track.id, clipId);
  };

  const handleResizeStart = (
    e: React.MouseEvent,
    clipId: string,
    side: "left" | "right"
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip) return;

    setResizing({
      clipId,
      side,
      startX: e.clientX,
      initialTrimStart: clip.trimStart,
      initialTrimEnd: clip.trimEnd,
    });
  };

  const updateTrimFromMouseMove = (e: { clientX: number }) => {
    if (!resizing) return;

    const clip = track.clips.find((c) => c.id === resizing.clipId);
    if (!clip) return;

    const deltaX = e.clientX - resizing.startX;
    const deltaTime = deltaX / (50 * zoomLevel);

    if (resizing.side === "left") {
      const newTrimStart = Math.max(
        0,
        Math.min(
          clip.duration - clip.trimEnd - 0.1,
          resizing.initialTrimStart + deltaTime
        )
      );
      updateClipTrim(track.id, clip.id, newTrimStart, clip.trimEnd);
    } else {
      const newTrimEnd = Math.max(
        0,
        Math.min(
          clip.duration - clip.trimStart - 0.1,
          resizing.initialTrimEnd - deltaTime
        )
      );
      updateClipTrim(track.id, clip.id, clip.trimStart, newTrimEnd);
    }
  };

  const handleResizeMove = (e: React.MouseEvent) => {
    updateTrimFromMouseMove(e);
  };

  const handleResizeEnd = () => {
    setResizing(null);
  };

  const [justFinishedDrag, setJustFinishedDrag] = useState(false);

  const handleClipMouseDown = (e: React.MouseEvent, clip: any) => {
    // Handle selection first
    if (!justFinishedDrag) {
      const isSelected = selectedClips.some(
        (c) => c.trackId === track.id && c.clipId === clip.id
      );

      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        // Multi-selection mode: toggle the clip
        selectClip(track.id, clip.id, true);
      } else if (!isSelected) {
        // If clip is not selected, select it (replacing other selections)
        selectClip(track.id, clip.id, false);
      }
      // Note: Don't deselect if already selected, as user might want to drag
    }

    // Calculate the offset from the left edge of the clip to where the user clicked
    const clipElement = e.currentTarget as HTMLElement;
    const clipRect = clipElement.getBoundingClientRect();
    const clickOffsetX = e.clientX - clipRect.left;
    const clickOffsetTime = clickOffsetX / (50 * zoomLevel);

    startDrag(e, clip.id, track.id, clip.startTime, clickOffsetTime);
  };

  // Reset drag flag when drag ends
  useEffect(() => {
    if (!isDragging && justFinishedDrag) {
      const timer = setTimeout(() => setJustFinishedDrag(false), 50);
      return () => clearTimeout(timer);
    } else if (isDragging && !justFinishedDrag) {
      setJustFinishedDrag(true);
    }
  }, [isDragging, justFinishedDrag]);

  const handleTrackDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    // Handle both timeline clips and media items
    const hasTimelineClip = e.dataTransfer.types.includes(
      "application/x-timeline-clip"
    );
    const hasMediaItem = e.dataTransfer.types.includes(
      "application/x-media-item"
    );

    if (!hasTimelineClip && !hasMediaItem) return;

    if (hasMediaItem) {
      try {
        const mediaItemData = e.dataTransfer.getData(
          "application/x-media-item"
        );
        if (mediaItemData) {
          const { type } = JSON.parse(mediaItemData);
          const isCompatible =
            (track.type === "video" &&
              (type === "video" || type === "image")) ||
            (track.type === "audio" && type === "audio");

          if (!isCompatible) {
            e.dataTransfer.dropEffect = "none";
            return;
          }
        }
      } catch (error) {}
    }

    // Calculate drop position for overlap checking
    const trackContainer = e.currentTarget.querySelector(
      ".track-clips-container"
    ) as HTMLElement;
    let dropTime = 0;
    if (trackContainer) {
      const rect = trackContainer.getBoundingClientRect();
      const mouseX = Math.max(0, e.clientX - rect.left);
      dropTime = mouseX / (50 * zoomLevel);
    }

    // Check for potential overlaps and show appropriate feedback
    let wouldOverlap = false;

    if (hasMediaItem) {
      try {
        const mediaItemData = e.dataTransfer.getData(
          "application/x-media-item"
        );
        if (mediaItemData) {
          const { id } = JSON.parse(mediaItemData);
          const mediaItem = mediaItems.find((item) => item.id === id);
          if (mediaItem) {
            const newClipDuration = mediaItem.duration || 5;
            const snappedTime = Math.round(dropTime * 10) / 10;
            const newClipEnd = snappedTime + newClipDuration;

            wouldOverlap = track.clips.some((existingClip) => {
              const existingStart = existingClip.startTime;
              const existingEnd =
                existingClip.startTime +
                (existingClip.duration -
                  existingClip.trimStart -
                  existingClip.trimEnd);
              return snappedTime < existingEnd && newClipEnd > existingStart;
            });
          }
        }
      } catch (error) {
        // Continue with default behavior
      }
    } else if (hasTimelineClip) {
      try {
        const timelineClipData = e.dataTransfer.getData(
          "application/x-timeline-clip"
        );
        if (timelineClipData) {
          const { clipId, trackId: fromTrackId } = JSON.parse(timelineClipData);
          const sourceTrack = tracks.find(
            (t: TimelineTrack) => t.id === fromTrackId
          );
          const movingClip = sourceTrack?.clips.find(
            (c: any) => c.id === clipId
          );

          if (movingClip) {
            const movingClipDuration =
              movingClip.duration - movingClip.trimStart - movingClip.trimEnd;
            const snappedTime = Math.round(dropTime * 10) / 10;
            const movingClipEnd = snappedTime + movingClipDuration;

            wouldOverlap = track.clips.some((existingClip) => {
              if (fromTrackId === track.id && existingClip.id === clipId)
                return false;

              const existingStart = existingClip.startTime;
              const existingEnd =
                existingClip.startTime +
                (existingClip.duration -
                  existingClip.trimStart -
                  existingClip.trimEnd);
              return snappedTime < existingEnd && movingClipEnd > existingStart;
            });
          }
        }
      } catch (error) {
        // Continue with default behavior
      }
    }

    if (wouldOverlap) {
      e.dataTransfer.dropEffect = "none";
      setWouldOverlap(true);
      setDropPosition(Math.round(dropTime * 10) / 10);
      return;
    }

    e.dataTransfer.dropEffect = hasTimelineClip ? "move" : "copy";
    setWouldOverlap(false);
    setDropPosition(Math.round(dropTime * 10) / 10);
  };

  const handleTrackDragEnter = (e: React.DragEvent) => {
    e.preventDefault();

    const hasTimelineClip = e.dataTransfer.types.includes(
      "application/x-timeline-clip"
    );
    const hasMediaItem = e.dataTransfer.types.includes(
      "application/x-media-item"
    );

    if (!hasTimelineClip && !hasMediaItem) return;

    dragCounterRef.current++;
    setIsDropping(true);
  };

  const handleTrackDragLeave = (e: React.DragEvent) => {
    e.preventDefault();

    const hasTimelineClip = e.dataTransfer.types.includes(
      "application/x-timeline-clip"
    );
    const hasMediaItem = e.dataTransfer.types.includes(
      "application/x-media-item"
    );

    if (!hasTimelineClip && !hasMediaItem) return;

    dragCounterRef.current--;

    if (dragCounterRef.current === 0) {
      setIsDropping(false);
      setWouldOverlap(false);
      setDropPosition(null);
    }
  };

  const handleTrackDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Reset all drag states
    dragCounterRef.current = 0;
    setIsDropping(false);
    setWouldOverlap(false);
    const currentDropPosition = dropPosition;
    setDropPosition(null);

    const hasTimelineClip = e.dataTransfer.types.includes(
      "application/x-timeline-clip"
    );
    const hasMediaItem = e.dataTransfer.types.includes(
      "application/x-media-item"
    );

    if (!hasTimelineClip && !hasMediaItem) return;

    const trackContainer = e.currentTarget.querySelector(
      ".track-clips-container"
    ) as HTMLElement;
    if (!trackContainer) return;

    const rect = trackContainer.getBoundingClientRect();
    const mouseX = Math.max(0, e.clientX - rect.left);
    const newStartTime = mouseX / (50 * zoomLevel);
    const snappedTime = Math.round(newStartTime * 10) / 10;

    try {
      if (hasTimelineClip) {
        // Handle timeline clip movement
        const timelineClipData = e.dataTransfer.getData(
          "application/x-timeline-clip"
        );
        if (!timelineClipData) return;

        const {
          clipId,
          trackId: fromTrackId,
          clickOffsetTime = 0,
        } = JSON.parse(timelineClipData);

        // Find the clip being moved
        const sourceTrack = tracks.find(
          (t: TimelineTrack) => t.id === fromTrackId
        );
        const movingClip = sourceTrack?.clips.find((c: any) => c.id === clipId);

        if (!movingClip) {
          toast.error("Clip not found");
          return;
        }

        // Adjust position based on where user clicked on the clip
        const adjustedStartTime = snappedTime - clickOffsetTime;
        const finalStartTime = Math.max(
          0,
          Math.round(adjustedStartTime * 10) / 10
        );

        // Check for overlaps with existing clips (excluding the moving clip itself)
        const movingClipDuration =
          movingClip.duration - movingClip.trimStart - movingClip.trimEnd;
        const movingClipEnd = finalStartTime + movingClipDuration;

        const hasOverlap = track.clips.some((existingClip) => {
          // Skip the clip being moved if it's on the same track
          if (fromTrackId === track.id && existingClip.id === clipId)
            return false;

          const existingStart = existingClip.startTime;
          const existingEnd =
            existingClip.startTime +
            (existingClip.duration -
              existingClip.trimStart -
              existingClip.trimEnd);

          // Check if clips overlap
          return finalStartTime < existingEnd && movingClipEnd > existingStart;
        });

        if (hasOverlap) {
          toast.error(
            "Cannot move clip here - it would overlap with existing clips"
          );
          return;
        }

        if (fromTrackId === track.id) {
          // Moving within same track
          updateClipStartTime(track.id, clipId, finalStartTime);
        } else {
          // Moving to different track
          moveClipToTrack(fromTrackId, track.id, clipId);
          requestAnimationFrame(() => {
            updateClipStartTime(track.id, clipId, finalStartTime);
          });
        }
      } else if (hasMediaItem) {
        // Handle media item drop
        const mediaItemData = e.dataTransfer.getData(
          "application/x-media-item"
        );
        if (!mediaItemData) return;

        const { id, type } = JSON.parse(mediaItemData);
        const mediaItem = mediaItems.find((item) => item.id === id);

        if (!mediaItem) {
          toast.error("Media item not found");
          return;
        }

        // Check if track type is compatible
        const isCompatible =
          (track.type === "video" && (type === "video" || type === "image")) ||
          (track.type === "audio" && type === "audio");

        if (!isCompatible) {
          toast.error(`Cannot add ${type} to ${track.type} track`);
          return;
        }

        // Check for overlaps with existing clips
        const newClipDuration = mediaItem.duration || 5;
        const newClipEnd = snappedTime + newClipDuration;

        const hasOverlap = track.clips.some((existingClip) => {
          const existingStart = existingClip.startTime;
          const existingEnd =
            existingClip.startTime +
            (existingClip.duration -
              existingClip.trimStart -
              existingClip.trimEnd);

          // Check if clips overlap
          return snappedTime < existingEnd && newClipEnd > existingStart;
        });

        if (hasOverlap) {
          toast.error(
            "Cannot place clip here - it would overlap with existing clips"
          );
          return;
        }

        addClipToTrack(track.id, {
          mediaId: mediaItem.id,
          name: mediaItem.name,
          duration: mediaItem.duration || 5,
          startTime: snappedTime,
          trimStart: 0,
          trimEnd: 0,
        });

        toast.success(`Added ${mediaItem.name} to ${track.name}`);
      }
    } catch (error) {
      console.error("Error handling drop:", error);
      toast.error("Failed to add media to track");
    }
  };

  const getTrackColor = (type: string) => {
    switch (type) {
      case "video":
        return "bg-blue-500/20 border-blue-500/30";
      case "audio":
        return "bg-green-500/20 border-green-500/30";
      case "effects":
        return "bg-purple-500/20 border-purple-500/30";
      default:
        return "bg-gray-500/20 border-gray-500/30";
    }
  };

  const renderClipContent = (clip: any) => {
    const mediaItem = mediaItems.find((item) => item.id === clip.mediaId);

    if (!mediaItem) {
      return (
        <span className="text-xs text-foreground/80 truncate">{clip.name}</span>
      );
    }

    if (mediaItem.type === "image") {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <img
            src={mediaItem.url}
            alt={mediaItem.name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        </div>
      );
    }

    if (mediaItem.type === "video" && mediaItem.thumbnailUrl) {
      return (
        <div className="w-full h-full flex items-center gap-2">
          <div className="w-8 h-8 flex-shrink-0">
            <img
              src={mediaItem.thumbnailUrl}
              alt={mediaItem.name}
              className="w-full h-full object-cover rounded-sm"
              draggable={false}
            />
          </div>
          <span className="text-xs text-foreground/80 truncate flex-1">
            {clip.name}
          </span>
        </div>
      );
    }

    if (mediaItem.type === "audio") {
      return (
        <div className="w-full h-full flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <AudioWaveform
              audioUrl={mediaItem.url}
              height={24}
              className="w-full"
            />
          </div>
        </div>
      );
    }

    // Fallback for videos without thumbnails
    return (
      <span className="text-xs text-foreground/80 truncate">{clip.name}</span>
    );
  };

  const handleSplitClip = (clip: any) => {
    // Use current playback time as split point
    const splitTime = currentTime;
    // Only split if splitTime is within the clip's effective range
    const effectiveStart = clip.startTime;
    const effectiveEnd =
      clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
    if (splitTime <= effectiveStart || splitTime >= effectiveEnd) return;
    const firstDuration = splitTime - effectiveStart;
    const secondDuration = effectiveEnd - splitTime;
    // First part: adjust original clip
    updateClipTrim(
      track.id,
      clip.id,
      clip.trimStart,
      clip.trimEnd + secondDuration
    );
    // Second part: add new clip after split
    addClipToTrack(track.id, {
      mediaId: clip.mediaId,
      name: clip.name + " (cut)",
      duration: clip.duration,
      startTime: splitTime,
      trimStart: clip.trimStart + firstDuration,
      trimEnd: clip.trimEnd,
    });
  };

  return (
    <div
      className="w-full h-full hover:bg-muted/20"
      onContextMenu={(e) => {
        e.preventDefault();
        // Only show track menu if we didn't click on a clip
        if (!(e.target as HTMLElement).closest(".timeline-clip")) {
          setContextMenu({
            type: "track",
            trackId: track.id,
            x: e.clientX,
            y: e.clientY,
          });
        }
      }}
      onDragOver={handleTrackDragOver}
      onDragEnter={handleTrackDragEnter}
      onDragLeave={handleTrackDragLeave}
      onDrop={handleTrackDrop}
      onMouseMove={handleResizeMove}
      onMouseUp={(e) => {
        handleResizeEnd();
        if (isDragging) {
          endDrag(track.id);
        }
      }}
      onMouseLeave={handleResizeEnd}
    >
      <div
        ref={timelineRef}
        className="h-full relative track-clips-container min-w-full"
      >
        {track.clips.length === 0 ? (
          <div
            className={`h-full w-full rounded-sm border-2 border-dashed flex items-center justify-center text-xs text-muted-foreground transition-colors ${
              isDropping
                ? wouldOverlap
                  ? "border-red-500 bg-red-500/10 text-red-600"
                  : "border-blue-500 bg-blue-500/10 text-blue-600"
                : "border-muted/30"
            }`}
          >
            {isDropping
              ? wouldOverlap
                ? "Cannot drop - would overlap"
                : "Drop clip here"
              : "Drop media here"}
          </div>
        ) : (
          <>
            {track.clips.map((clip) => {
              const effectiveDuration =
                clip.duration - clip.trimStart - clip.trimEnd;
              const clipWidth = Math.max(
                80,
                effectiveDuration * 50 * zoomLevel
              );

              // Use real-time position during drag, otherwise use stored position
              const dragPosition = getDraggedClipPosition(clip.id);
              const clipStartTime =
                dragPosition !== null ? dragPosition : clip.startTime;
              const clipLeft = clipStartTime * 50 * zoomLevel;

              const isSelected = selectedClips.some(
                (c) => c.trackId === track.id && c.clipId === clip.id
              );

              const isBeingDragged = draggedClipId === clip.id;
              return (
                <div
                  key={clip.id}
                  className={`timeline-clip absolute h-full border ${getTrackColor(track.type)} flex items-center py-3 min-w-[80px] overflow-hidden group hover:shadow-lg ${isSelected ? "ring-2 ring-blue-500 z-10" : ""} ${isBeingDragged ? "shadow-lg z-20" : ""} ${isBeingDragged ? "cursor-grabbing" : "cursor-grab"}`}
                  style={{ width: `${clipWidth}px`, left: `${clipLeft}px` }}
                  onMouseDown={(e) => handleClipMouseDown(e, clip)}
                  onClick={(e) => {
                    e.stopPropagation();

                    // Don't handle click if we just finished dragging
                    if (justFinishedDrag) {
                      return;
                    }

                    // Close context menu if it's open
                    if (contextMenu) {
                      setContextMenu(null);
                      return; // Don't handle selection when closing context menu
                    }

                    // Only handle deselection here (selection is handled in mouseDown)
                    const isSelected = selectedClips.some(
                      (c) => c.trackId === track.id && c.clipId === clip.id
                    );

                    if (isSelected && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                      // If clip is already selected and no modifier keys, deselect it
                      deselectClip(track.id, clip.id);
                    }
                  }}
                  tabIndex={0}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({
                      type: "clip",
                      trackId: track.id,
                      clipId: clip.id,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  {/* Left trim handle */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-2 cursor-w-resize transition-opacity bg-blue-500/50 hover:bg-blue-500 ${isSelected ? "opacity-100" : "opacity-0"}`}
                    onMouseDown={(e) => {
                      e.stopPropagation(); // Prevent triggering clip drag
                      handleResizeStart(e, clip.id, "left");
                    }}
                  />
                  {/* Clip content */}
                  <div className="flex-1 relative">
                    {renderClipContent(clip)}
                    {/* Clip options menu */}
                    <div className="absolute top-1 right-1 z-10">
                      <Button
                        variant="text"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setClipMenuOpen(clip.id)}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                      {clipMenuOpen === clip.id && (
                        <div
                          className="absolute right-0 mt-2 w-32 bg-white border rounded shadow z-50"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button
                            className="flex items-center w-full px-3 py-2 text-sm hover:bg-muted/30"
                            onClick={() => {
                              handleSplitClip(clip);
                              setClipMenuOpen(null);
                            }}
                          >
                            <Scissors className="h-4 w-4 mr-2" /> Split
                          </button>
                          <button
                            className="flex items-center w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                            onClick={() => handleDeleteClip(clip.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Right trim handle */}
                  <div
                    className={`absolute right-0 top-0 bottom-0 w-2 cursor-e-resize transition-opacity bg-blue-500/50 hover:bg-blue-500 ${isSelected ? "opacity-100" : "opacity-0"}`}
                    onMouseDown={(e) => {
                      e.stopPropagation(); // Prevent triggering clip drag
                      handleResizeStart(e, clip.id, "right");
                    }}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
