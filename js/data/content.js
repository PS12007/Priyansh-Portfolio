/* All site copy lives here. Nothing in js/backgrounds reads this file and
   nothing here knows about the visual system, so the two can be iterated on
   independently. Edit this file to change the site's content. */
window.PF = window.PF || {};

PF.content = {
  meta: {
    name: 'Priyansh Sharma',
    role: 'Software Engineer · ML Systems · Mechatronics',
    location: 'London, Ontario',
    /* The small pulsing status line under the intro. Set to null to hide it. */
    status: { label: 'Now', value: 'LazyKV — long context on one 8 GB GPU' },
    intro:
      'I take things that are slow and make them fast, and things that don’t fit in memory and make them fit anyway. ' +
      'Lately that means LLM inference on a laptop GPU: Triton kernels, KV caches, profilers, and the measurements that keep them honest. ' +
      'Mechatronic Systems Engineering at Western, dual degree with Ivey.',
  },

  /* Order here drives both the nav and the section order on the page. */
  sections: [
    { id: 'home', label: 'Home' },
    { id: 'projects', label: 'Projects' },
    { id: 'experience', label: 'Experience' },
    { id: 'skills', label: 'Skills' },
    { id: 'education', label: 'Education' },
    { id: 'contact', label: 'Contact' },
  ],

  links: [
    { label: 'Email', href: 'mailto:priyanshcan@gmail.com' },
    { label: 'GitHub', href: 'https://github.com/PS12007' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/priyansh-sharma-ps12' },
    /* To link a resume, drop the PDF at assets/resume.pdf and uncomment:
       { label: 'Resume', href: 'assets/resume.pdf' }, */
  ],

  /* Strongest and most current first. The first one opens by default.

     Every figure below is copied from the project's own measurements, with
     the condition it was measured under kept attached. Nothing is rounded up
     and nothing unmeasured is claimed; keep it that way as results land. */
  projects: [
    {
      title: 'LazyKV',
      category: 'Inference Systems',
      year: '2026',
      summary:
        'How much long context fits on one 8 GB laptop GPU: a tiered KV-cache runtime, and an honest study of the policies that decide what stays in VRAM.',
      detail:
        'LazyKV treats VRAM as a cache over a larger KV cache held in pinned host RAM, then compares residency policies on equal terms: same model, same budget sweep, same prompts, same quality metrics. ' +
        'Every data path on the laptop was measured before a policy was written. At 65K tokens, fetching a layer’s offloaded KV costs 11.5× the attention it feeds, which ruled out dense offload before anything depended on it. ' +
        'Five policies are measured so far, negative results included, and no number in its docs is typed by hand: they render from the raw metrics, and a test fails if a doc drifts from its data.',
      stats: [
        { value: '98.8%', label: 'of full-cache needle accuracy kept by query-aware selection at a 75% attended budget, 32K tokens' },
        { value: '225/225', label: 'prompts where block LRU matched a sinkless window exactly: it evicts before it sees a use' },
        { value: '4.9×', label: 'VRAM over PCIe bandwidth, measured, where the design brief had assumed 20–40×' },
      ],
      tech: ['Python', 'PyTorch', 'CUDA', 'Transformers'],
      links: [{ label: 'Code', href: 'https://github.com/PS12007/LazyKV' }],
    },
    {
      title: 'Fused Quantized-KV Kernel',
      category: 'GPU Kernels',
      year: '2026',
      summary:
        'A Triton kernel that runs decode attention directly on a packed 2- or 4-bit KV cache, without ever materialising a full-precision copy.',
      detail:
        'Packed sub-byte codes are addressed in-register with a stride-and-shift index, so no dequantised tile is ever written, and the history is split flash-decoding style with the unpack paid once per GQA group. ' +
        'The headline 9.5–38× over PyTorch SDPA was taken apart rather than quoted: nearly all of it is the split. The quantization only pays once the cache spills out of L2, a crossing predicted in writing before the run and then measured at 1.04× L2. ' +
        'An adversarial auditor built alongside it caught an early result overstated roughly 12× by GPU clock throttling.',
      stats: [
        { value: '10.5–26×', label: 'from splitting the history across programs' },
        { value: '0.73–1.48×', label: 'from the 4-bit quantization itself, depending on whether the cache fits in L2' },
        { value: '146', label: 'correctness tests, cosine ≥ 0.99999 against the dequantize-then-attend reference' },
      ],
      tech: ['Triton', 'PyTorch', 'CUDA'],
      links: [{ label: 'Code', href: 'https://github.com/PS12007/tritonkv' }],
    },
    {
      title: 'tokenscope',
      category: 'Profiling',
      year: '2026',
      summary:
        'A per-token profiler for llama.cpp: the time of every generated token, attributed to the part of the forward pass that spent it.',
      detail:
        'Lock-free, per-thread timing scopes compiled into llama.cpp through a three-file patch and flushed as Chrome Trace Event JSON for Perfetto. ' +
        'At full detail it records every graph node on every worker thread, millions of events a run, for under 1% decode overhead, measured against a null control rather than assumed. ' +
        'It found 11% of worker time spent waiting at barriers rather than computing, showed that time per phase follows weight bytes rather than parameter counts, and caught one CMake flag swinging decode throughput by more than half, in opposite directions depending on the compiler’s OpenMP runtime.',
      stats: [
        { value: '<1%', label: 'decode overhead with every graph node traced, across all three builds' },
        { value: '3× · 11×', label: 'best thread scaling for decode against prefill, same 8B model, same cores' },
        { value: '0.3 pt', label: 'error predicting each phase’s share of time from its share of weight bytes' },
      ],
      tech: ['C++17', 'llama.cpp', 'Python', 'Perfetto'],
      links: [{ label: 'Code', href: 'https://github.com/PS12007/tokenscope' }],
    },
    {
      title: 'Video to Humanoid',
      category: 'Robotics / Vision',
      year: '2026',
      summary: 'A monocular video of a person in; a physically simulated Unitree G1 humanoid doing the same motion out.',
      detail:
        'Four stages, each verified before the next: recover SMPL-X motion from video, retarget it to the G1, then train a physics-based RL tracking policy so the robot balances through the motion instead of replaying joint angles into the floor. ' +
        'Stage 1 runs natively on Windows and an RTX 50-series GPU, which upstream does not support: a CUDA 12.8 build of torch, pytorch3d compiled from source, and a linker failure traced to setuptools no longer routing MSVC compiles through torch’s build hook. ' +
        'The output is checked numerically, not trusted on a clean exit.',
      stats: [
        { value: '2m 44s', label: 'from an 8.5 s clip to a full SMPL-X motion solve, on a laptop running on battery' },
        { value: '1.2 cm', label: 'mean per-frame step over 255 frames, with zero body-shape drift' },
      ],
      tech: ['PyTorch', 'CUDA', 'SMPL-X', 'MuJoCo', 'RL'],
      links: [{ label: 'Code', href: 'https://github.com/PS12007/video-to-humanoid-mimicry' }],
    },
    {
      title: 'Locret for llama.cpp',
      category: 'Inference',
      year: '2026',
      summary: 'Small trained heads that decide which KV-cache entries are worth keeping, ported into llama.cpp.',
      detail:
        'Retaining heads score cached tokens so chunked prefill can evict the least useful ones instead of the oldest. ' +
        'The integration is designed against llama.cpp’s real eval-callback and memory APIs, read from source rather than guessed at. ' +
        'Not yet benchmarked on hardware, so no speed numbers are claimed.',
      stats: [{ value: '4.6e-7', label: 'max absolute error of the C++ retaining head against its PyTorch reference' }],
      tech: ['C++', 'llama.cpp', 'PyTorch'],
      links: [{ label: 'Code', href: 'https://github.com/PS12007/locret-llamacpp' }],
    },
    {
      title: 'TermCinema',
      category: 'Graphics / Tools',
      year: '2026',
      summary:
        'Watch anything in a terminal — files, YouTube, a webcam — as sub-cell block art, or as real pixels where the terminal allows.',
      detail:
        'Each character cell is treated as a tiny two-colour image, and the renderer picks the glyph and both colours that best reproduce the source pixels. ' +
        'Terminal video bottlenecks on writing escape codes rather than on image maths, so encoding is vectorised in NumPy and diffed against what the terminal already shows. ' +
        'Audio is the master clock, so sync holds and late frames drop rather than drag. Twelve renderers, including kitty, iTerm2 and sixel graphics.',
      stats: [
        { value: '~236 fps', label: 'half-block render and encode ceiling at 160×45 cells, truecolor' },
        { value: '0 B', label: 'written for a frame the terminal is already showing' },
      ],
      tech: ['Python', 'NumPy', 'numba', 'FFmpeg'],
      links: [{ label: 'Code', href: 'https://github.com/PS12007/termcinema' }],
    },
    {
      title: 'Artists With Souls',
      category: 'Adversarial ML',
      year: '2025',
      summary: 'Perturbations that leave artwork looking the same to people and useless to the models that scrape it.',
      detail:
        'FGSM and PGD attacks against a ResNet-50 proxy disrupt feature extraction while preserving how the image looks, with Grad-CAM showing the model’s attention slide off the subject once protection is applied. ' +
        'Perturbations are computed on a downscaled 512px pass and blended back to full resolution.',
      stats: [{ value: '>90%', label: 'less processing time from attacking the 512px proxy instead of the full image' }],
      tech: ['PyTorch', 'Flask', 'Celery', 'Redis', 'CUDA'],
      links: [{ label: 'Code', href: 'https://github.com/PS12007/Artists-with-souls---AWS' }],
    },
    {
      title: 'SurFur',
      category: 'Full Stack',
      year: '2025',
      badge: 'Hackathon winner',
      summary: 'Food-surplus matching between donors and shelters. Won Hackathon Guelph.',
      detail:
        'A matching engine ranks shelters by proximity, urgency and capacity, with dietary-compatibility filtering. ' +
        'Built end to end under hackathon time: REST API, PostgreSQL data model, and a Next.js front end with a live map and urgency alerts.',
      stats: [{ value: '90 min', label: 'before an unclaimed listing automatically re-broadcasts' }],
      tech: ['Next.js', 'TypeScript', 'PostgreSQL', 'Leaflet', 'SendGrid'],
      links: [{ label: 'Code', href: 'https://github.com/PS12007/surfur' }],
    },
    {
      title: 'Silent Failure',
      category: 'Observability',
      year: '2025',
      summary: 'Anomaly detection for the degradations that uptime monitoring never catches.',
      detail:
        'Reads behavioural signals and cross-service logs to surface failures that stay invisible to conventional alerting. Currently in stealth.',
      tech: ['Python', 'Anomaly Detection'],
      links: [],
    },
  ],

  experience: [
    {
      role: 'Founder',
      org: 'Stealth Startup',
      period: '2025 — Present',
      notes: [
        'Leading product, design, and engineering end to end for an early-stage software company.',
        'Shipping and killing MVPs quickly, cutting whatever does not hold up under real usage.',
      ],
    },
    {
      role: 'Software Engineering Intern',
      org: 'Avante Pathways',
      period: 'Apr — Sep 2025',
      notes: [
        'Built internal tools for data tracking and workflow automation, replacing manual processes.',
        'Built AI tooling for resume writing and college application workflows on the OpenAI API, across Python, React, and Node.js.',
      ],
    },
    {
      role: 'Freelance Developer',
      org: 'Independent',
      period: '2023 — Present',
      notes: [
        'Designed and shipped websites and web applications for local and online clients.',
        'Scoped requirements directly with clients and delivered production-ready work.',
      ],
    },
  ],

  skills: [
    { group: 'Languages', items: ['Python', 'C++', 'C', 'TypeScript', 'JavaScript', 'Java', 'MATLAB', 'SQL'] },
    { group: 'GPU / ML', items: ['CUDA', 'Triton', 'PyTorch', 'llama.cpp', 'Transformers', 'Quantization', 'Computer Vision', 'Adversarial ML'] },
    { group: 'Performance', items: ['Profiling & tracing', 'Benchmark design', 'Parallel programming', 'Memory hierarchy'] },
    { group: 'Web / Data', items: ['React', 'Next.js', 'Node.js', 'Flask', 'PostgreSQL', 'Redis', 'Celery'] },
    { group: 'Tools', items: ['Git', 'Linux', 'Docker', 'CMake', 'Perfetto'] },
  ],

  education: [
    {
      org: 'Western University',
      detail: 'BESc, Mechatronic Systems Engineering',
      period: 'Expected 2029',
      notes: ['GPA 3.9 / 4.0', 'Dean’s Honour List, 2025–26'],
    },
    {
      org: 'Ivey Business School',
      detail: 'HBA, Advanced Entry Opportunity',
      period: 'Dual degree',
      notes: ['Merit-based early admission'],
    },
  ],

  awards: [
    {
      title: '1st Place — Western × Canadian Nuclear Laboratories Case Competition',
      year: '2025',
      note: 'Multi-layer radiation shielding for a lunar base, pitched to a CNL engineering panel.',
    },
    {
      title: 'Winner — Hackathon Guelph',
      year: '2025',
      note: 'SurFur, food-surplus matching between donors and shelters.',
    },
  ],

  contact: {
    headline: 'Let’s build something.',
    note: 'Open to internships and interesting problems — especially the ones that are too slow, or don’t fit.',
  },
};
