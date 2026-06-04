package main

import (
	"bufio"
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/ggampp/sprite-lab/internal/generate"
	"github.com/ggampp/sprite-lab/internal/server"
)

func main() {
	loadDotEnv(".env")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	models := splitCSV(os.Getenv("OPENROUTER_ALLOWED_IMAGE_MODELS"))
	generator := generate.NewService(generate.Config{
		APIKey:        os.Getenv("OPENROUTER_API_KEY"),
		AllowedModels: models,
		AppURL:        envOr("SPRITE_LAB_PUBLIC_URL", "http://localhost:8787"),
		AppTitle:      envOr("SPRITE_LAB_APP_TITLE", "Sprite Lab"),
	})

	app := server.New(server.Config{
		Addr:          envOr("SPRITE_LAB_ADDR", ":8787"),
		StaticDir:     envOr("SPRITE_LAB_STATIC_DIR", "dist"),
		AllowedOrigin: os.Getenv("SPRITE_LAB_ALLOWED_ORIGIN"),
	}, generator)

	slog.Info("starting sprite lab server", "addr", envOr("SPRITE_LAB_ADDR", ":8787"))
	if err := app.ListenAndServe(ctx); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func envOr(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func loadDotEnv(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key == "" || os.Getenv(key) != "" {
			continue
		}
		_ = os.Setenv(key, value)
	}
}
