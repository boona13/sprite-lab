# Sprite Lab 2D Game Asset Roadmap

## Objetivo

Transformar o Sprite Lab em uma ferramenta completa de preparacao de assets para jogos 2D:

```text
Imagem / spritesheet
  -> remover fundo
  -> detectar frames
  -> normalizar e alinhar frames
  -> montar animacoes
  -> configurar pivots e hitboxes
  -> recompor atlas/spritesheet
  -> exportar para engines
```

O projeto deve continuar sendo 100% local, deterministico e sem backend.

## Status De Execucao

- Fase 1: modelo central de dados criado.
- Fase 2: normalizacao de frames implementada no core e exposta na UI do slicer.

## Principios De Implementacao

- Manter o processamento pesado no `src/core`, operando em `RgbaImage`.
- Deixar DOM, Canvas browser e downloads em adaptadores de UI.
- Evitar concentrar novas funcionalidades em `src/main.ts`; criar modulos pequenos.
- Preservar compatibilidade com o fluxo atual de remover fundo, fatiar e exportar ZIP.
- Evoluir o manifest aos poucos, mantendo dados suficientes para engines 2D.

## Fase 1: Modelo De Dados Central

Criar um modelo unico para frames, animacoes, pivots, boxes e exportacao.

Arquivos sugeridos:

```text
src/core/types.ts
src/projectModel.ts
```

Tipos principais:

```ts
export interface SpriteFrame {
  id: string;
  index: number;
  image: RgbaImage;
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
  trimmedWidth: number;
  trimmedHeight: number;
  originalWidth?: number;
  originalHeight?: number;
  pivot: Pivot;
  boxes: FrameBox[];
}

export interface Pivot {
  x: number;
  y: number;
  mode: 'center' | 'bottom-center' | 'top-left' | 'custom';
}

export interface FrameBox {
  id: string;
  type: 'collision' | 'hurtbox' | 'hitbox' | 'pickup';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteAnimation {
  id: string;
  name: string;
  frameIds: string[];
  fps: number;
  loop: boolean;
}

export interface SpriteProject {
  version: 1;
  name: string;
  frames: SpriteFrame[];
  animations: SpriteAnimation[];
  exportSettings: ExportSettings;
}
```

Instrucoes:

- Atualizar a extracao atual para produzir frames enriquecidos.
- Manter aliases ou campos antigos enquanto a UI ainda depender deles.
- Adicionar helper para criar `SpriteProject` a partir dos frames detectados.

## Fase 2: Normalizacao De Frames E Pivots

Prioridade alta.

Problema resolvido: frames com crops diferentes fazem personagens "pularem" na engine.

Funcionalidades:

- Padronizar todos os frames no mesmo canvas.
- Alinhar por centro, base, topo esquerdo ou pivot.
- Definir padding.
- Preservar informacoes de trim.
- Preview antes/depois.

Arquivo sugerido:

```text
src/core/normalizeFrames.ts
```

API:

```ts
export function normalizeFrames(
  frames: SpriteFrame[],
  options: NormalizeOptions,
): SpriteFrame[]
```

Opcoes:

```ts
interface NormalizeOptions {
  mode: 'max-size' | 'custom-size';
  width?: number;
  height?: number;
  align: 'center' | 'bottom-center' | 'top-left' | 'pivot';
  padding: number;
}
```

Instrucoes:

- Criar novo `RgbaImage` por frame.
- Copiar pixels para a posicao alinhada.
- Ajustar pivot para o novo canvas.
- Nao destruir `sourceX/sourceY`.

## Fase 3: Editor De Animacoes

Prioridade alta.

Funcionalidades:

- Criar animacoes como `idle`, `walk`, `run`, `jump`, `attack`.
- Selecionar frames por animacao.
- Reordenar frames.
- Definir FPS e loop por animacao.
- Preview da animacao selecionada.

Arquivos sugeridos:

```text
src/animationEditor.ts
src/projectModel.ts
```

UI:

- Lista de animacoes.
- Botao adicionar/remover/renomear.
- Grid de frames disponiveis.
- Timeline horizontal.
- Controle de FPS.
- Toggle de loop.

Exportacao:

```json
{
  "animations": {
    "walk": {
      "frames": [0, 1, 2, 3],
      "fps": 12,
      "loop": true
    }
  }
}
```

## Fase 4: Exportacao Para Engines

Prioridade alta.

Criar exporters dedicados:

```text
src/exporters/
  manifest.ts
  phaser.ts
  pixi.ts
  godot.ts
  unity.ts
  aseprite.ts
```

API:

```ts
export interface ExportedFile {
  path: string;
  content: string | Blob | Uint8Array;
}

export function exportProject(
  project: SpriteProject,
  target: ExportTarget,
): Promise<ExportedFile[]>
```

Targets:

```ts
type ExportTarget =
  | 'generic-json'
  | 'phaser'
  | 'pixi'
  | 'godot'
  | 'unity'
  | 'aseprite';
```

Ordem de implementacao:

1. Generic JSON.
2. Phaser atlas JSON.
3. Godot-friendly JSON.
4. Unity-friendly JSON.
5. PixiJS JSON.
6. Aseprite-compatible JSON.

## Fase 5: Spritesheet Recomposer / Texture Atlas

Prioridade alta/media.

Funcionalidades:

- Recompor frames como strip horizontal.
- Recompor como grid.
- Recompor como atlas compacto.
- Configurar colunas, padding e spacing.
- Extrusao de bordas para evitar texture bleeding.
- Fundo transparente ou cor de debug.

Arquivo sugerido:

```text
src/core/atlas.ts
```

API:

```ts
export function composeAtlas(
  frames: SpriteFrame[],
  options: AtlasOptions,
): AtlasResult
```

Opcoes:

```ts
interface AtlasOptions {
  layout: 'horizontal' | 'grid' | 'packed';
  columns?: number;
  padding: number;
  spacing: number;
  extrude: number;
}
```

## Fase 6: Pivot Editor Visual

Prioridade alta/media.

Funcionalidades:

- Definir pivot global.
- Definir pivot por frame.
- Presets: centro, base central, topo esquerdo e custom.
- Crosshair visual sobre o frame.
- Aplicar ao frame atual, animacao atual ou todos os frames.

Export:

```json
{
  "pivot": {
    "x": 0.5,
    "y": 1,
    "pixelX": 32,
    "pixelY": 64
  }
}
```

## Fase 7: Hitboxes, Hurtboxes E Collision Boxes

Prioridade media/alta.

Funcionalidades:

- Desenhar caixas sobre o frame.
- Tipos: `collision`, `hurtbox`, `hitbox`, `pickup`.
- Copiar boxes entre frames.
- Aplicar box em toda animacao.
- Editar posicao/tamanho por inputs numericos.

Arquivo sugerido:

```text
src/boxEditor.ts
```

Export:

```json
{
  "boxes": [
    {
      "type": "hurtbox",
      "x": 12,
      "y": 8,
      "width": 40,
      "height": 52
    }
  ]
}
```

## Fase 8: Preview De Gameplay

Prioridade media.

Funcionalidades:

- Preview em escala 1x, 2x e 4x.
- Alternar fundo.
- Simular movimento horizontal.
- Mostrar pivot no chao.
- Mostrar boxes.
- Render pixel-perfect.

Arquivo sugerido:

```text
src/gamePreview.ts
```

Instrucoes:

- Usar `requestAnimationFrame`.
- Renderizar em canvas.
- Definir `ctx.imageSmoothingEnabled = false`.

## Fase 9: Ferramentas Pixel Art

Prioridade media.

Funcionalidades:

- Scale nearest-neighbor.
- Outline automatico.
- Sombra simples.
- Remover pixels soltos.
- Expandir/contrair alpha.
- Troca de paleta.

Arquivos sugeridos:

```text
src/core/pixelTools/
  scale.ts
  outline.ts
  shadow.ts
  alphaMorphology.ts
  cleanup.ts
  palette.ts
```

Ordem:

1. Scale nearest-neighbor.
2. Outline.
3. Alpha expand/contract.
4. Remove isolated pixels.
5. Palette swap.

## Fase 10: Deteccao De Grid Assistida

Prioridade media.

Funcionalidades:

- Modo `Auto components`.
- Modo `Grid`.
- Detectar ou informar largura/altura de celula.
- Configurar colunas, linhas, margem e spacing.
- Preview das linhas de corte.

Arquivo sugerido:

```text
src/core/gridExtract.ts
```

API:

```ts
export function extractFramesFromGrid(
  source: RgbaImage,
  options: GridExtractOptions,
): SpriteFrame[]
```

Opcoes:

```ts
interface GridExtractOptions {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  marginX: number;
  marginY: number;
  spacingX: number;
  spacingY: number;
  trimTransparent: boolean;
}
```

## Fase 11: Manifest Rico

Prioridade media.

Formato recomendado:

```json
{
  "version": 2,
  "name": "hero",
  "image": "atlas.png",
  "frames": [],
  "animations": {},
  "meta": {
    "app": "Sprite Lab",
    "format": "generic-json"
  }
}
```

Cada frame:

```json
{
  "id": "frame_001",
  "index": 0,
  "x": 0,
  "y": 0,
  "width": 64,
  "height": 64,
  "sourceX": 12,
  "sourceY": 20,
  "pivot": { "x": 0.5, "y": 1 },
  "boxes": []
}
```

## Fase 12: Organizacao Da UI

Substituir gradualmente as duas abas atuais por um fluxo de producao:

```text
1. Import
2. Clean
3. Slice
4. Normalize
5. Animate
6. Configure
7. Export
```

Implementacao inicial:

- Manter tudo em uma pagina.
- Usar secoes expansivas.
- Modularizar comportamento em arquivos TS.
- Migrar `main.ts` para orquestracao.

## Primeiro Marco Entregavel

O primeiro marco util para jogos 2D deve entregar:

```text
Detectar frames
-> normalizar todos no mesmo tamanho
-> definir pivot base-center
-> criar uma animacao
-> exportar atlas.png + manifest.json
```

Esse marco transforma o Sprite Lab em uma ferramenta pratica de preparacao de sprites para engines 2D.

## Ordem Recomendada De Execucao

1. Criar modelo `SpriteProject`, `SpriteFrame`, `SpriteAnimation`.
2. Adaptar extracao atual para gerar frames enriquecidos.
3. Adicionar normalizacao de frames.
4. Adicionar pivots basicos.
5. Atualizar manifest para versao 2.
6. Criar editor de animacoes.
7. Criar recomposicao de atlas/grid.
8. Criar exporters generic/phaser/godot.
9. Criar editor de hitboxes.
10. Criar preview de gameplay.
11. Adicionar grid extraction.
12. Adicionar pixel tools.
13. Adicionar exporters extras: Unity, Pixi e Aseprite.
