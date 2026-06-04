package generate

type Preset struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
	AspectRatio string `json:"aspectRatio"`
	ImageSize   string `json:"imageSize"`
}

var Presets = []Preset{
	{
		ID:          "character-idle",
		Label:       "Character idle sheet",
		Description: "Four-frame character idle animation on transparent or plain background.",
		Prompt:      "Create a clean 2D game sprite sheet with 4 evenly spaced frames of a character idle animation. Pixel art, readable silhouette, consistent pose scale, transparent or flat solid background, no text, no watermark.",
		AspectRatio: "1:1",
		ImageSize:   "1K",
	},
	{
		ID:          "walk-cycle",
		Label:       "Walk cycle",
		Description: "Six-frame side-view walk cycle for platformers.",
		Prompt:      "Create a 2D game sprite sheet with 6 evenly spaced frames of a side-view character walk cycle. Pixel art, consistent character size, clear gaps between frames, transparent or flat solid background, no text, no watermark.",
		AspectRatio: "16:9",
		ImageSize:   "1K",
	},
	{
		ID:          "attack-animation",
		Label:       "Attack animation",
		Description: "Four-frame melee attack animation.",
		Prompt:      "Create a 2D game sprite sheet with 4 evenly spaced frames of a character melee attack animation. Strong readable silhouette, consistent sprite scale, clear gaps between frames, transparent or flat solid background, no text, no watermark.",
		AspectRatio: "16:9",
		ImageSize:   "1K",
	},
	{
		ID:          "item-icon",
		Label:       "Item icon",
		Description: "Single collectible item or inventory icon.",
		Prompt:      "Create a single 2D game item icon. Pixel art, centered object, clean silhouette, transparent or flat solid background, no text, no watermark.",
		AspectRatio: "1:1",
		ImageSize:   "1K",
	},
	{
		ID:          "projectile",
		Label:       "Projectile",
		Description: "Single projectile or effect sprite.",
		Prompt:      "Create a single 2D game projectile sprite. Pixel art, centered, clean silhouette, transparent or flat solid background, no text, no watermark.",
		AspectRatio: "1:1",
		ImageSize:   "1K",
	},
	{
		ID:          "top-down-tileset",
		Label:       "Top-down tileset",
		Description: "Small top-down terrain tileset with clear tile boundaries.",
		Prompt:      "Create a compact top-down 2D game tileset. Pixel art, square tiles arranged in a grid, clear tile boundaries, grass, dirt, stone, water variants, no text, no watermark.",
		AspectRatio: "1:1",
		ImageSize:   "1K",
	},
	{
		ID:          "ui-button-icon",
		Label:       "UI button/icon",
		Description: "Game UI button or ability icon.",
		Prompt:      "Create a polished 2D game UI icon or button asset. Centered design, readable at small sizes, transparent or flat solid background, no text, no watermark.",
		AspectRatio: "1:1",
		ImageSize:   "1K",
	},
}

func PresetByID(id string) (Preset, bool) {
	for _, preset := range Presets {
		if preset.ID == id {
			return preset, true
		}
	}
	return Preset{}, false
}
