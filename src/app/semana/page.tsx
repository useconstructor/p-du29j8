import type { Metadata } from "next";
import { Board } from "@/components/pulso/board";

export const metadata: Metadata = { title: "Semana · Pulso" };
export default function WeekPage() { return <Board week />; }
