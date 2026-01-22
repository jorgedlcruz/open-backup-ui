"use client"

import { useMemo } from "react"
import { TriggeredAlarmItem } from "@/lib/types/veeam-one-alarms"
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps"
import { useTheme } from "next-themes"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"

interface AlarmWorldMapProps {
    data: TriggeredAlarmItem[]
}

export function AlarmWorldMap({ data }: AlarmWorldMapProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    const mapItems = data.filter(d => d.latitude && d.longitude && d.status_Count);

    // Calculate center and zoom based on marker positions
    const { center, zoom } = useMemo(() => {
        if (mapItems.length === 0) {
            return { center: [0, 20] as [number, number], zoom: 1 };
        }

        // Get bounds of all markers
        const lats = mapItems.map(item => item.latitude!);
        const lngs = mapItems.map(item => item.longitude!);

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        // Calculate center
        const centerLng = (minLng + maxLng) / 2;
        const centerLat = (minLat + maxLat) / 2;

        // Calculate span
        const latSpan = maxLat - minLat;
        const lngSpan = maxLng - minLng;
        const maxSpan = Math.max(latSpan, lngSpan);

        // Calculate zoom based on span - larger span = lower zoom
        // Add some padding (1.5x) to ensure markers aren't at edges
        let calculatedZoom = 1;
        if (maxSpan < 5) {
            calculatedZoom = 8; // Very focused region
        } else if (maxSpan < 15) {
            calculatedZoom = 5;
        } else if (maxSpan < 30) {
            calculatedZoom = 3;
        } else if (maxSpan < 60) {
            calculatedZoom = 2;
        } else if (maxSpan < 120) {
            calculatedZoom = 1.5;
        } else {
            calculatedZoom = 1;
        }

        return {
            center: [centerLng, centerLat] as [number, number],
            zoom: calculatedZoom
        };
    }, [mapItems]);

    return (
        <div className="relative w-full h-[262px] rounded-lg border p-6 text-left shadow-sm bg-card border-border overflow-hidden">
            <dt className="text-sm font-medium text-foreground mb-2">
                Global Impact
            </dt>
            <div className="absolute inset-x-0 top-12 bottom-0">
                <TooltipProvider>
                    <ComposableMap
                        projection="geoMercator"
                        projectionConfig={{ scale: 100, center: [0, 30] }}
                        style={{ width: '100%', height: '100%' }}
                    >
                        <ZoomableGroup center={center} zoom={zoom}>
                            <Geographies geography={GEO_URL}>
                                {({ geographies }) =>
                                    geographies.map((geo) => (
                                        <Geography
                                            key={geo.rsmKey}
                                            geography={geo}
                                            fill={isDark ? "#374151" : "#E2E8F0"}
                                            stroke={isDark ? "#4B5563" : "#CBD5E0"}
                                            strokeWidth={0.5}
                                            style={{
                                                default: { outline: "none" },
                                                hover: { fill: isDark ? "#4B5563" : "#D1D5DB", outline: "none" },
                                                pressed: { outline: "none" },
                                            }}
                                        />
                                    ))
                                }
                            </Geographies>
                            {mapItems.map((item, index) => {
                                if (!item.latitude || !item.longitude) return null;

                                const color =
                                    item.status === 'Error' ? '#ef4444' :
                                        item.status === 'Warning' ? '#f97316' :
                                            item.status === 'Resolved' ? '#22c55e' : '#3b82f6';

                                return (
                                    <Marker key={index} coordinates={[item.longitude, item.latitude]}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <g className="cursor-pointer hover:opacity-80 transition-opacity">
                                                    <circle r={6} fill={color} stroke="#fff" strokeWidth={1.5} />
                                                    {item.status === 'Error' && (
                                                        <animate attributeName="r" values="6;8;6" dur="2s" repeatCount="indefinite" />
                                                    )}
                                                </g>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <div className="text-xs font-semibold">
                                                    <p>{item.cityName || 'Unknown Location'}</p>
                                                    <p className="font-normal text-muted-foreground">{item.status_Count} {item.status}</p>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </Marker>
                                )
                            })}
                        </ZoomableGroup>
                    </ComposableMap>
                </TooltipProvider>
            </div>
        </div>
    )
}
