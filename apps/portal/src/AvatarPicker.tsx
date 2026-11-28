import { useState } from "react";
import { Avatar } from "./ui";
import { CHARACTER_AVATARS, CHESS_AVATARS } from "./AvatarArt";
import { prepareAvatarPhoto } from "./avatarPhoto";
import type { AvatarChoice, AvatarStyle, User } from "./types";
import { useLanguage } from "./ui";

export function AvatarPicker({ user, avatar, photo, choose, choosePhoto, onProcessing }: {
  user: User; avatar: AvatarChoice | ""; photo: string | null;
  choose: (value: AvatarChoice | "") => void; choosePhoto: (value: string) => void; onProcessing: (value: boolean) => void;
}) {
  const { t } = useLanguage();
  const [error, setError] = useState("");
  const labels: Record<AvatarStyle, string> = {
    king: t("Король", "King"), queen: t("Ферзь", "Queen"), rook: t("Ладья", "Rook"),
    bishop: t("Слон", "Bishop"), knight: t("Конь", "Knight"), pawn: t("Пешка", "Pawn"),
    fox: t("Лис", "Fox"), cat: t("Кот", "Cat"), owl: t("Сова", "Owl"), robot: t("Робот", "Robot"),
    astronaut: t("Космонавт", "Astronaut"), dragon: t("Дракон", "Dragon"), dice: t("Кубик", "Dice"), comet: t("Комета", "Comet"),
  };
  const option = (value: AvatarChoice | "", label: string) => <button type="button" key={value || "initials"}
    className="avatar-option" aria-label={`${t("Аватар", "Avatar")}: ${label}`} aria-pressed={avatar === value}
    onClick={() => { setError(""); choose(value); }}>
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
          setError(""); onProcessing(true);
          void prepareAvatarPhoto(file).then(choosePhoto).catch(() => setError(t("Не удалось открыть фото. Выберите изображение до 20 МБ.", "Could not open the photo. Choose an image up to 20 MB."))).finally(() => onProcessing(false));
        }}/>
    </label>
    <small>{t("Фото увидят другие игроки. Центр изображения станет аватаром.", "Other players will see your photo. The centre of the image becomes your avatar.")}</small>
    {error && <p className="avatar-photo-error" role="alert">{error}</p>}
  </fieldset>;
}
