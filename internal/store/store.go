package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

const sessionTTL = 14 * 24 * time.Hour

type Store struct {
	db *sql.DB
}

type User struct {
	ID        int64     `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type Session struct {
	Token     string
	UserID    int64
	ExpiresAt time.Time
}

type Project struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"-"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ProjectImage struct {
	ID        int64     `json:"id"`
	ProjectID int64     `json:"projectId"`
	Kind      string    `json:"kind"`
	Name      string    `json:"name"`
	Prompt    string    `json:"prompt,omitempty"`
	Model     string    `json:"model,omitempty"`
	ImageData string    `json:"imageData"`
	CreatedAt time.Time `json:"createdAt"`
}

func Open(ctx context.Context, path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		path = "sprite-lab.sqlite"
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	store := &Store{db: db}
	if err := store.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate(ctx context.Context) error {
	stmts := []string{
		`PRAGMA foreign_keys = ON`,
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS projects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS project_images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			kind TEXT NOT NULL CHECK(kind IN ('generated', 'attached')),
			name TEXT NOT NULL,
			prompt TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL DEFAULT '',
			image_data TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_project_images_project_id ON project_images(project_id)`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) CreateUser(ctx context.Context, email, name, password string) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	if email == "" || !strings.Contains(email, "@") {
		return User{}, errors.New("valid email is required")
	}
	if name == "" {
		return User{}, errors.New("name is required")
	}
	if len(password) < 8 {
		return User{}, errors.New("password must be at least 8 characters")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}

	res, err := s.db.ExecContext(ctx,
		`INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)`,
		email, name, string(hash),
	)
	if err != nil {
		return User{}, fmt.Errorf("create user: %w", err)
	}
	id, _ := res.LastInsertId()
	return s.UserByID(ctx, id)
}

func (s *Store) Authenticate(ctx context.Context, email, password string) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var user User
	var hash string
	var created string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?`,
		email,
	).Scan(&user.ID, &user.Email, &user.Name, &hash, &created)
	if err != nil {
		return User{}, errors.New("invalid credentials")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return User{}, errors.New("invalid credentials")
	}
	user.CreatedAt = parseDBTime(created)
	return user, nil
}

func (s *Store) UserByID(ctx context.Context, id int64) (User, error) {
	var user User
	var created string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, name, created_at FROM users WHERE id = ?`,
		id,
	).Scan(&user.ID, &user.Email, &user.Name, &created)
	user.CreatedAt = parseDBTime(created)
	return user, err
}

func (s *Store) CreateSession(ctx context.Context, userID int64) (Session, error) {
	token, err := randomToken()
	if err != nil {
		return Session{}, err
	}
	expires := time.Now().UTC().Add(sessionTTL)
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
		token, userID, formatDBTime(expires),
	)
	if err != nil {
		return Session{}, err
	}
	return Session{Token: token, UserID: userID, ExpiresAt: expires}, nil
}

func (s *Store) UserBySession(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, errors.New("missing session")
	}
	var userID int64
	var expires string
	err := s.db.QueryRowContext(ctx,
		`SELECT user_id, expires_at FROM sessions WHERE token = ?`,
		token,
	).Scan(&userID, &expires)
	if err != nil {
		return User{}, errors.New("invalid session")
	}
	if time.Now().UTC().After(parseDBTime(expires)) {
		_ = s.DeleteSession(ctx, token)
		return User{}, errors.New("session expired")
	}
	return s.UserByID(ctx, userID)
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token = ?`, token)
	return err
}

func (s *Store) CreateProject(ctx context.Context, userID int64, name string) (Project, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Project{}, errors.New("project name is required")
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO projects (user_id, name) VALUES (?, ?)`,
		userID, name,
	)
	if err != nil {
		return Project{}, err
	}
	id, _ := res.LastInsertId()
	return s.ProjectByID(ctx, userID, id)
}

func (s *Store) ListProjects(ctx context.Context, userID int64) ([]Project, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, user_id, name, created_at, updated_at
		 FROM projects WHERE user_id = ? ORDER BY updated_at DESC, id DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var p Project
		var created, updated string
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &created, &updated); err != nil {
			return nil, err
		}
		p.CreatedAt = parseDBTime(created)
		p.UpdatedAt = parseDBTime(updated)
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (s *Store) ProjectByID(ctx context.Context, userID, projectID int64) (Project, error) {
	var p Project
	var created, updated string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, user_id, name, created_at, updated_at
		 FROM projects WHERE user_id = ? AND id = ?`,
		userID, projectID,
	).Scan(&p.ID, &p.UserID, &p.Name, &created, &updated)
	p.CreatedAt = parseDBTime(created)
	p.UpdatedAt = parseDBTime(updated)
	return p, err
}

func (s *Store) AddProjectImage(ctx context.Context, userID, projectID int64, image ProjectImage) (ProjectImage, error) {
	if _, err := s.ProjectByID(ctx, userID, projectID); err != nil {
		return ProjectImage{}, errors.New("project not found")
	}
	image.Name = strings.TrimSpace(image.Name)
	if image.Name == "" {
		image.Name = "image.png"
	}
	if image.Kind != "generated" && image.Kind != "attached" {
		return ProjectImage{}, errors.New("invalid image kind")
	}
	if !strings.HasPrefix(image.ImageData, "data:image/") {
		return ProjectImage{}, errors.New("image data must be a data URL")
	}
	if len(image.ImageData) > 10*1024*1024 {
		return ProjectImage{}, errors.New("image data is too large")
	}

	res, err := s.db.ExecContext(ctx,
		`INSERT INTO project_images (project_id, kind, name, prompt, model, image_data)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		projectID, image.Kind, image.Name, image.Prompt, image.Model, image.ImageData,
	)
	if err != nil {
		return ProjectImage{}, err
	}
	id, _ := res.LastInsertId()
	_, _ = s.db.ExecContext(ctx, `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, projectID)
	return s.ProjectImageByID(ctx, userID, projectID, id)
}

func (s *Store) ListProjectImages(ctx context.Context, userID, projectID int64) ([]ProjectImage, error) {
	if _, err := s.ProjectByID(ctx, userID, projectID); err != nil {
		return nil, errors.New("project not found")
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, project_id, kind, name, prompt, model, image_data, created_at
		 FROM project_images WHERE project_id = ? ORDER BY id DESC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var images []ProjectImage
	for rows.Next() {
		var image ProjectImage
		var created string
		if err := rows.Scan(&image.ID, &image.ProjectID, &image.Kind, &image.Name, &image.Prompt, &image.Model, &image.ImageData, &created); err != nil {
			return nil, err
		}
		image.CreatedAt = parseDBTime(created)
		images = append(images, image)
	}
	return images, rows.Err()
}

func (s *Store) ProjectImageByID(ctx context.Context, userID, projectID, imageID int64) (ProjectImage, error) {
	if _, err := s.ProjectByID(ctx, userID, projectID); err != nil {
		return ProjectImage{}, errors.New("project not found")
	}
	var image ProjectImage
	var created string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, project_id, kind, name, prompt, model, image_data, created_at
		 FROM project_images WHERE project_id = ? AND id = ?`,
		projectID, imageID,
	).Scan(&image.ID, &image.ProjectID, &image.Kind, &image.Name, &image.Prompt, &image.Model, &image.ImageData, &created)
	image.CreatedAt = parseDBTime(created)
	return image, err
}

func randomToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func formatDBTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

func parseDBTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02 15:04:05", value); err == nil {
		return t.UTC()
	}
	return time.Time{}
}
