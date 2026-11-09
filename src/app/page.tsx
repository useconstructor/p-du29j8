import type { Metadata } from "next";
import { Board } from "@/components/pulso/board";

export const metadata: Metadata = { title: "Hoy · Pulso" };
export default function TodayPage() { return <Board />; }
