package generate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"
)

const (
	DefaultModel      = "google/gemini-2.5-flash-image"
	openRouterAPIURL  = "https://openrouter.ai/api/v1/chat/completions"
	maxPromptLength   = 1200
	maxNegativeLength = 500
)

var (
	AllowedAspectRatios = []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}
	AllowedImageSizes   = []string{"0.5K", "1K", "2K", "4K"}
	DefaultModels       = []string{
		"google/gemini-2.5-flash-image",
		"google/gemini-3.1-flash-image-preview",
		"black-forest-labs/flux.2-pro",
		"black-forest-labs/flux.2-flex",
		"sourceful/riverflow-v2-standard-preview",
	}
)

type Request struct {
	Prompt       string `json:"prompt"`
	PresetID     string `json:"presetId"`
	Model        string `json:"model"`
	AspectRatio  string `json:"aspectRatio"`
	ImageSize    string `json:"imageSize"`
	NegativeHint string `json:"negativeHint"`
}

type Response struct {
	ImageURL string `json:"imageUrl"`
	Model    string `json:"model"`
	Prompt   string `json:"prompt"`
	Content  string `json:"content,omitempty"`
}

type Config struct {
	APIKey        string
	AllowedModels []string
	AppURL        string
	AppTitle      string
}

type Service struct {
	cfg    Config
	client *http.Client
}

func NewService(cfg Config) *Service {
	if len(cfg.AllowedModels) == 0 {
		cfg.AllowedModels = DefaultModels
	}
	if cfg.AppURL == "" {
		cfg.AppURL = "http://localhost"
	}
	if cfg.AppTitle == "" {
		cfg.AppTitle = "Sprite Lab"
	}

	return &Service{
		cfg: cfg,
		client: &http.Client{
			Timeout: 75 * time.Second,
		},
	}
}

func (s *Service) AllowedModels() []string {
	return append([]string(nil), s.cfg.AllowedModels...)
}

func (s *Service) Generate(ctx context.Context, input Request) (Response, error) {
	req, err := s.normalize(input)
	if err != nil {
		return Response{}, err
	}
	if strings.TrimSpace(s.cfg.APIKey) == "" {
		return Response{}, errors.New("OPENROUTER_API_KEY is not configured")
	}

	payload := openRouterRequest{
		Model:      req.Model,
		Modalities: []string{"image", "text"},
		Stream:     false,
		Messages: []openRouterMessage{
			{Role: "user", Content: req.Prompt},
		},
		ImageConfig: openRouterImageConfig{
			AspectRatio: req.AspectRatio,
			ImageSize:   req.ImageSize,
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return Response{}, fmt.Errorf("encode request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, openRouterAPIURL, bytes.NewReader(body))
	if err != nil {
		return Response{}, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Title", s.cfg.AppTitle)
	httpReq.Header.Set("HTTP-Referer", s.cfg.AppURL)

	res, err := s.client.Do(httpReq)
	if err != nil {
		return Response{}, fmt.Errorf("openrouter request failed: %w", err)
	}
	defer res.Body.Close()

	limited := io.LimitReader(res.Body, 12*1024*1024)
	resBody, err := io.ReadAll(limited)
	if err != nil {
		return Response{}, fmt.Errorf("read response: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return Response{}, openRouterHTTPError(res.StatusCode, resBody)
	}

	var parsed openRouterResponse
	if err := json.Unmarshal(resBody, &parsed); err != nil {
		return Response{}, fmt.Errorf("decode response: %w", err)
	}

	for _, choice := range parsed.Choices {
		for _, image := range choice.Message.Images {
			if strings.HasPrefix(image.ImageURL.URL, "data:image/") {
				return Response{
					ImageURL: image.ImageURL.URL,
					Model:    req.Model,
					Prompt:   req.Prompt,
					Content:  strings.TrimSpace(choice.Message.Content),
				}, nil
			}
		}
	}

	return Response{}, errors.New("OpenRouter response did not include an image")
}

func (s *Service) normalize(input Request) (Request, error) {
	prompt := strings.TrimSpace(input.Prompt)
	if input.PresetID != "" {
		preset, ok := PresetByID(input.PresetID)
		if !ok {
			return Request{}, errors.New("unknown preset")
		}
		prompt = strings.TrimSpace(preset.Prompt + " " + prompt)
		if input.AspectRatio == "" {
			input.AspectRatio = preset.AspectRatio
		}
		if input.ImageSize == "" {
			input.ImageSize = preset.ImageSize
		}
	}
	if prompt == "" {
		return Request{}, errors.New("prompt is required")
	}
	if len(prompt) > maxPromptLength {
		return Request{}, fmt.Errorf("prompt must be %d characters or fewer", maxPromptLength)
	}

	negative := strings.TrimSpace(input.NegativeHint)
	if len(negative) > maxNegativeLength {
		return Request{}, fmt.Errorf("negative hint must be %d characters or fewer", maxNegativeLength)
	}
	if negative != "" {
		prompt += " Avoid: " + negative + "."
	}

	model := strings.TrimSpace(input.Model)
	if model == "" {
		model = s.cfg.AllowedModels[0]
	}
	if !slices.Contains(s.cfg.AllowedModels, model) {
		return Request{}, errors.New("model is not allowed")
	}

	aspectRatio := strings.TrimSpace(input.AspectRatio)
	if aspectRatio == "" {
		aspectRatio = "1:1"
	}
	if !slices.Contains(AllowedAspectRatios, aspectRatio) {
		return Request{}, errors.New("aspect ratio is not allowed")
	}

	imageSize := strings.TrimSpace(input.ImageSize)
	if imageSize == "" {
		imageSize = "1K"
	}
	if !slices.Contains(AllowedImageSizes, imageSize) {
		return Request{}, errors.New("image size is not allowed")
	}

	return Request{
		Prompt:      prompt,
		PresetID:    input.PresetID,
		Model:       model,
		AspectRatio: aspectRatio,
		ImageSize:   imageSize,
	}, nil
}

func openRouterHTTPError(status int, body []byte) error {
	var parsed struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &parsed); err == nil && parsed.Error.Message != "" {
		return fmt.Errorf("OpenRouter returned %d: %s", status, parsed.Error.Message)
	}
	return fmt.Errorf("OpenRouter returned %d", status)
}

type openRouterRequest struct {
	Model       string                `json:"model"`
	Messages    []openRouterMessage   `json:"messages"`
	Modalities  []string              `json:"modalities"`
	Stream      bool                  `json:"stream"`
	ImageConfig openRouterImageConfig `json:"image_config"`
}

type openRouterMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openRouterImageConfig struct {
	AspectRatio string `json:"aspect_ratio"`
	ImageSize   string `json:"image_size"`
}

type openRouterResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
			Images  []struct {
				Type     string `json:"type"`
				ImageURL struct {
					URL string `json:"url"`
				} `json:"image_url"`
			} `json:"images"`
		} `json:"message"`
	} `json:"choices"`
}
