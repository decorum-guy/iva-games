import { useRef, useState } from "react";
import { Avatar } from "./ui";
import { CHARACTER_AVATARS, CHESS_AVATARS } from "./AvatarArt";
import { cropAvatarPhoto, openAvatarPhoto } from "./avatarPhoto";
import type { AvatarCrop, AvatarPhotoSource } from "./avatarPhoto";
import type { AvatarChoice, AvatarStyle, User } from "./types";
import { useLanguage } from "./ui";

export function AvatarPicker({ user, avatar, photo, choose, choosePhoto, onProcessing }: {
  user: User; avatar: AvatarChoice | ""; photo: string | null;
  choose: (value: AvatarChoice | "") => void; choosePhoto: (value: string) => void; onProcessing: (value: boolean) => void;
}) {
  const { t } = useLanguage();
  const [error, setError] = useState("");
  const [source, setSource] = useState<AvatarPhotoSource | null>(null);
  const [crop, setCrop] = useState<AvatarCrop>({ x: .5, y: .5, zoom: 1 });
  const generation = useRef(0);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; size: number } | null>(null);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const cancelCrop = () => { generation.current++; setSource(null); onProcessing(false); };
  const labels: Record<AvatarStyle, string> = {
    king: t("Король", "King"), queen: t("Ферзь", "Queen"), rook: t("Ладья", "Rook"),
    bishop: t("Слон", "Bishop"), knight: t("Конь", "Knight"), pawn: t("Пешка", "Pawn"),
    fox: t("Лис", "Fox"), cat: t("Кот", "Cat"), owl: t("Сова", "Owl"), robot: t("Робот", "Robot"),
    astronaut: t("Космонавт", "Astronaut"), dragon: t("Дракон", "Dragon"), dice: t("Кубик", "Dice"), comet: t("Комета", "Comet"),
  };
  const option = (value: AvatarChoice | "", label: string) => <button type="button" key={value || "initials"}
    className="avatar-option" aria-label={`${t("Аватар", "Avatar")}: ${label}`} aria-pressed={avatar === value}
    onClick={() => { setError(""); cancelCrop(); choose(value); }}>
    <Avatar player={{ ...user, avatar: value || undefined }} photoPreview={value === "photo" ? photo ?? undefined : undefined}/>
    <span>{label}</span>
  </button>;
  return <fieldset className="avatar-picker">
    <legend>{t("Выберите аватар", "Choose an avatar")}</legend>
    <div className="avatar-picker-group">
      <span>{t("Фигуры", "Chess pieces")}</span>
      <div className="avatar-options">{option("", t("Инициалы", "Initials"))}{CHESS_AVATARS.map(style => option(style, labels[style]))}</div>
    </div>
    <div className="avatar-picker-group">
      <span>{t("Персонажи", "Characters")}</span>
      <div className="avatar-options">{CHARACTER_AVATARS.map(style => option(style, labels[style]))}
        {(user.avatar === "photo" || photo) && option("photo", t("Моё фото", "My photo"))}</div>
    </div>
    <label className="avatar-upload">
      <span>{photo || user.avatar === "photo" ? t("Выбрать другое фото", "Choose another photo") : t("Загрузить своё фото", "Upload your photo")}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" aria-label={t("Загрузить фото", "Upload photo")}
        onChange={event => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          input.value = "";
          if (!file) return;
          const request = ++generation.current;
          setError(""); setSource(null); onProcessing(true);
          void openAvatarPhoto(file).then(image => {
            if (generation.current !== request) return;
            setCrop({ x: .5, y: .5, zoom: 1 }); setSource(image);
          }).catch(() => {
            if (generation.current !== request) return;
            setError(t("Не удалось открыть фото. Выберите изображение до 20 МБ.", "Could not open the photo. Choose an image up to 20 MB."));
            onProcessing(false);
          });
        }}/>
    </label>
    {source && <div className="avatar-crop-editor">
      <strong>{t("Кадрирование", "Crop photo")}</strong>
      <p>{t("Передвиньте фото и выберите масштаб.", "Move the photo and choose its zoom.")}</p>
      <div className="avatar-crop-frame" role="group" tabIndex={0}
        aria-label={t("Положение фото. Перемещайте мышью или стрелками", "Photo position. Drag or use arrow keys")}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, startX: crop.x, startY: crop.y, size: event.currentTarget.clientWidth };
        }}
        onPointerMove={event => {
          if (!drag.current) return;
          const side = Math.min(source.width, source.height) / crop.zoom;
          const { x, y, startX, startY, size } = drag.current;
          setCrop(value => ({ ...value,
            x: source.width > side ? clamp(startX - (event.clientX - x) * side / (size * (source.width - side))) : .5,
            y: source.height > side ? clamp(startY - (event.clientY - y) * side / (size * (source.height - side))) : .5 }));
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={event => {
          const direction = { ArrowLeft: [-.05, 0], ArrowRight: [.05, 0], ArrowUp: [0, -.05], ArrowDown: [0, .05] }[event.key];
          if (!direction) return;
          event.preventDefault();
          setCrop(value => ({ ...value, x: clamp(value.x + direction[0]), y: clamp(value.y + direction[1]) }));
        }}>
        <img src={source.url} alt="" draggable={false} style={{
          width: `${source.width * crop.zoom / Math.min(source.width, source.height) * 100}%`,
          height: `${source.height * crop.zoom / Math.min(source.width, source.height) * 100}%`,
          left: `${-(source.width * crop.zoom / Math.min(source.width, source.height) - 1) * crop.x * 100}%`,
          top: `${-(source.height * crop.zoom / Math.min(source.width, source.height) - 1) * crop.y * 100}%`,
        }}/>
      </div>
      <label className="avatar-crop-zoom">{t("Масштаб", "Zoom")}
        <input type="range" min="1" max="3" step="0.05" value={crop.zoom}
          onChange={event => setCrop(value => ({ ...value, zoom: Number(event.target.value) }))}/>
      </label>
      <div className="avatar-crop-actions">
        <button className="button primary" type="button" onClick={() => {
          try { choosePhoto(cropAvatarPhoto(source, crop)); cancelCrop(); }
          catch { setError(t("Не удалось обработать фото. Попробуйте другое.", "Could not process the photo. Try another one.")); cancelCrop(); }
        }}>{t("Применить", "Apply")}</button>
        <button className="button" type="button" onClick={cancelCrop}>{t("Отмена", "Cancel")}</button>
      </div>
    </div>}
    <small>{t("Фото увидят другие игроки.", "Other players will see your photo.")}</small>
    {error && <p className="avatar-photo-error" role="alert">{error}</p>}
  </fieldset>;
}
