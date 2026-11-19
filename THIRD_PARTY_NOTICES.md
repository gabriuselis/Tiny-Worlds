# Three.js agent skills

The skills in `.agents/skills/`, `.claude/skills/`, and `.kilo/skills/` with names beginning `threejs-` are adapted from [Impertio-Studio/Three.js-Claude-Skill-Package](https://github.com/Impertio-Studio/Three.js-Claude-Skill-Package), commit `6c190f0db95d6e4b77d7843d181c6d3325c09d0e` (original author: OpenAEC Foundation).

The port retains the upstream API references, examples, and anti-patterns. Each `SKILL.md` adds a Tiny Worlds compatibility note and removes an upstream metadata field that the local skill validator does not accept. Sixteen WebGL-related skills were selected: core renderer, scene graph, math, raycaster; syntax geometries, materials, controls, shaders, loaders; implementation lighting, shadows, animation, postprocessing, audio; errors performance and rendering. The source pack's React Three Fiber, Drei, WebGPU, physics, IFC, XR, and orchestration skills are outside this game's current stack.

## Upstream license

MIT License

Copyright (c) 2026 OpenAEC Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
