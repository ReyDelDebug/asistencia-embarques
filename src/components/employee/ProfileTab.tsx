"use client";

import { useRef, useState, type FormEvent } from "react";
import { Alert, api, Avatar, Button, inputClass } from "../ui";
import MyDataForm from "./MyDataForm";

/** Recorta al centro en cuadrado y comprime a JPEG 320×320 en el celular. */
async function toSquareJpeg(file: File, size = 320): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo leer la imagen. Prueba con otra foto."));
      i.src = url;
    });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ProfileTab({
  employeeId, fullName, employeeNumber, area, photoVersion, onPhotoChanged,
}: {
  employeeId: number; fullName: string; employeeNumber: string; area: string;
  photoVersion: string | null; onPhotoChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoMsg, setPhotoMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pinMsg, setPinMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoMsg(null);
    setPhotoBusy(true);
    try {
      const image = await toSquareJpeg(file);
      await api("/api/me/photo", { method: "PUT", json: { image } });
      setPhotoMsg({ kind: "success", text: "Foto actualizada." });
      onPhotoChanged();
    } catch (err) {
      setPhotoMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await api("/api/me/photo", { method: "DELETE" });
      setPhotoMsg({ kind: "success", text: "Foto eliminada." });
      onPhotoChanged();
    } catch (err) {
      setPhotoMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function changePin(e: FormEvent) {
    e.preventDefault();
    setPinMsg(null);
    setPinBusy(true);
    try {
      await api("/api/me/pin", { method: "POST", json: { currentPin: current, newPin: next, newPinConfirm: repeat } });
      setPinMsg({ kind: "success", text: "Tu PIN se cambió correctamente. Úsalo a partir de ahora." });
      setCurrent(""); setNext(""); setRepeat("");
    } catch (err) {
      setPinMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setPinBusy(false);
    }
  }

  const pinField = (id: string, label: string, value: string, set: (v: string) => void, ac: string) => (
    <label htmlFor={id} className="block text-sm">
      <span className="mb-1 block font-semibold text-slate-700">{label}</span>
      <input id={id} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete={ac} required minLength={4} maxLength={6}
        value={value} onChange={(e) => set(e.target.value.replace(/\D/g, ""))}
        className={`${inputClass} py-2.5 tracking-[0.4em]`} />
    </label>
  );

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5 text-center shadow-sm">
        <div className="flex justify-center"><Avatar employeeId={employeeId} name={fullName} version={photoVersion} size={112} /></div>
        <p className="mt-3 text-lg font-bold text-slate-900">{fullName}</p>
        <p className="text-sm text-slate-500">#{employeeNumber} · {area}</p>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/*" className="hidden" onChange={onFile} />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button onClick={() => fileRef.current?.click()} loading={photoBusy}>{photoVersion ? "Cambiar foto" : "Agregar foto"}</Button>
          <Button variant="secondary" onClick={removePhoto} disabled={!photoVersion || photoBusy}>Quitar foto</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Tu foto solo la ven tus compañeros de área y los supervisores.</p>
        {photoMsg && <div className="mt-3 text-left"><Alert kind={photoMsg.kind}>{photoMsg.text}</Alert></div>}
      </div>

      <MyDataForm onSaved={onPhotoChanged} />

      <form onSubmit={changePin} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-base font-bold text-slate-900">Restablecer mi PIN</p>
        {pinField("curpin", "PIN actual", current, setCurrent, "current-password")}
        {pinField("newpinp", "PIN nuevo (4 a 6 números)", next, setNext, "new-password")}
        {pinField("newpinp2", "Repite el PIN nuevo", repeat, setRepeat, "new-password")}
        {pinMsg && <Alert kind={pinMsg.kind}>{pinMsg.text}</Alert>}
        <Button type="submit" loading={pinBusy} className="w-full">Guardar nuevo PIN</Button>
        <p className="text-xs text-slate-500">¿Olvidaste tu PIN actual? Pide a tu supervisor que lo restablezca; al entrar crearás uno nuevo.</p>
      </form>
    </section>
  );
}
