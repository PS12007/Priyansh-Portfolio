/* All site copy lives here. Edit this file to change what the page says;
   nothing in scene.js or main.js needs to change with it. */
window.SITE = {
  name: 'Priyansh Sharma',
  email: 'priyanshcan@gmail.com',

  links: [
    { label: 'Email', href: 'mailto:priyanshcan@gmail.com' },
    { label: 'GitHub', href: 'https://github.com/PS12007' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/priyansh-sharma-ps12' },
  ],

  /* The order projects appear in. The first eight show; the rest sit behind "show all". */
  featured: [
    'rvwasm', 'Aegis', 'LazyKV', 'Latent Cartographer', 'Fused Quantized-KV Kernel', 'segfund-mc', 'kv-notary', 'mlkem-rs', 'raftkv',
    'tokenscope', 'tinyfuse', 'Noether Check', 'kernelport', 'Hans Hunter', 'Arecibo Zero', 'Video to Humanoid', 'TermCinema', 'Locret for llama.cpp', 'Artists With Souls', 'SurFur',
  ],

  /* Projects are grouped; order inside a group is strongest first. */
  work: [
    {
      group: 'Systems & inference',
      items: [
        {
          title: 'rvwasm',
          kind: 'Emulation',
          year: '2026',
          summary: 'A RISC-V computer that runs in a browser tab, boots Linux, and can run backwards.',
          detail:
            'An RV64GC CPU written in Rust and compiled to WebAssembly, with paging, interrupts and the same devices as QEMU’s virt board. It boots xv6 and Linux 6.12 with BusyBox. Halt it and you can step back through the last couple of hundred million instructions exactly as they ran. Floating point is done in integer arithmetic so the native and browser builds stay bit-identical, which is what makes the time travel possible.',
          stats: [
            { value: '334 / 334', label: 'official riscv-tests passing, in both physical and virtual-memory variants' },
            { value: '~200M', label: 'instructions of xv6 you can step back through, held in 64 MB' },
            { value: '157 MIPS', label: 'in the WebAssembly interpreter, against 187 native' },
          ],
          tech: ['Rust', 'WebAssembly', 'RISC-V', 'Linux'],
          links: [
            { label: 'Live demo', href: 'https://ps12007.github.io/rvwasm/' },
            { label: 'Code', href: 'https://github.com/PS12007/rvwasm' },
          ],
        },
        {
          title: 'LazyKV',
          kind: 'Inference systems',
          year: '2026',
          summary: 'How much long context fits on one 8 GB laptop GPU: a tiered KV-cache runtime and a study of what should stay in VRAM.',
          detail:
            'LazyKV treats VRAM as a cache over a larger KV cache held in pinned host RAM, then compares residency policies on equal terms: same model, same budget sweep, same prompts, same quality metrics. Every data path on the laptop was measured before a policy was written. At 65K tokens, fetching a layer’s offloaded KV costs 11.5× the attention it feeds, which ruled out dense offload before anything depended on it.',
          stats: [
            { value: '98.8%', label: 'of full-cache needle accuracy kept by query-aware selection at a 75% attended budget, 32K tokens' },
            { value: '225 / 225', label: 'prompts where block LRU matched a sinkless window exactly: it evicts before it sees a use' },
            { value: '4.9×', label: 'VRAM over PCIe bandwidth, measured, where the design brief had assumed 20–40×' },
          ],
          tech: ['Python', 'PyTorch', 'CUDA', 'Transformers'],
          links: [{ label: 'Code', href: 'https://github.com/PS12007/LazyKV' }],
        },
        {
          title: 'Fused Quantized-KV Kernel',
          kind: 'GPU kernels',
          year: '2026',
          summary: 'A Triton kernel that runs decode attention directly on a packed 2- or 4-bit KV cache, with no full-precision copy in between.',
          detail:
            'Packed sub-byte codes are addressed in-register with a stride-and-shift index, so no dequantised tile is ever written, and the history is split flash-decoding style with the unpack paid once per GQA group. The headline 9.5–38× over PyTorch SDPA was taken apart rather than quoted: nearly all of it is the split. The quantization only pays once the cache spills out of L2, a crossing predicted in writing before the run and then measured at 1.04× L2.',
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
          kind: 'Profiling',
          year: '2026',
          summary: 'A per-token profiler for llama.cpp: the time of every generated token, attributed to the part of the forward pass that spent it.',
          detail:
            'Lock-free, per-thread timing scopes compiled into llama.cpp through a three-file patch and flushed as Chrome Trace Event JSON for Perfetto. At full detail it records every graph node on every worker thread, millions of events a run. It found 11% of worker time spent waiting at barriers rather than computing, and caught one CMake flag swinging decode throughput by more than half, in opposite directions depending on the compiler’s OpenMP runtime.',
          stats: [
            { value: '<1%', label: 'decode overhead with every graph node traced, measured against a null control' },
            { value: '3× · 11×', label: 'best thread scaling for decode against prefill, same 8B model, same cores' },
            { value: '0.3 pt', label: 'error predicting each phase’s share of time from its share of weight bytes' },
          ],
          tech: ['C++17', 'llama.cpp', 'Python', 'Perfetto'],
          links: [{ label: 'Code', href: 'https://github.com/PS12007/tokenscope' }],
        },
        {
          title: 'raftkv',
          kind: 'Distributed systems',
          year: '2026',
          summary: 'A replicated key-value store in Go. Raft written from scratch, plus a simulator whose whole job is to break it.',
          detail:
            'The whole cluster runs in one goroutine on a fake clock, with a network that drops, delays, duplicates and reorders messages while a nemesis crashes nodes, partitions them and kills new leaders moments after they are elected. Everything comes from one seed, so any failure replays message for message, and the full client history goes through a linearizability checker. Bugs get planted on purpose, and the simulator has to find them. It has also found two that nobody planted.',
          stats: [
            { value: '4,000', label: 'randomized seeds on every push, and 20,000 new ones every night' },
            { value: '8', label: 'deliberately planted Raft bugs caught, including the paper’s Figure 8' },
            { value: '330 ms', label: 'from kill -9 on the leader to a successful read from the new one' },
          ],
          tech: ['Go', 'Raft', 'gRPC'],
          links: [{ label: 'Code', href: 'https://github.com/PS12007/raftkv' }],
        },
        {
          title: 'mlkem-rs',
          kind: 'Cryptography',
          year: '2026',
          summary: 'Post-quantum key exchange from scratch in Rust, plus a timing-leak tester that has to catch the leaks I planted.',
          detail:
            'ML-KEM (NIST FIPS 203, formerly Kyber) at all three security levels with no runtime dependencies: field arithmetic, NTT, Keccak and the KEM are all written by hand and checked byte for byte against RustCrypto’s ml-kem. A dudect-style tester measures whether running time depends on secret data, natively and on V8’s machine code. Deliberately broken builds show it works: it catches an early-exit Decaps on both cores, and the KyberSlash division leak only on the E-core. The library also ships as a 58 KB WebAssembly module with a live browser demo.',
          stats: [
            { value: '240 / 240', label: 'NIST ACVP test vectors passing, natively and in WebAssembly' },
            { value: '|t| < 3', label: 'on every secret-dependent target, against ≥ 10 for the planted leaks' },
            { value: '8–28%', label: 'slower than RustCrypto’s ml-kem doing the same work, in portable scalar code' },
          ],
          tech: ['Rust', 'WebAssembly', 'Cryptography'],
          links: [
            { label: 'Live demo', href: 'https://ps12007.github.io/mlkem-rs/' },
            { label: 'Code', href: 'https://github.com/PS12007/mlkem-rs' },
          ],
        },
        {
          title: 'segfund-mc',
          kind: 'GPU Monte Carlo',
          year: '2026',
          summary: 'Pricing the guarantee on a segregated fund with four million simulated futures, in one fused Triton kernel.',
          detail:
            'A Monte Carlo engine for GMMB and GMDB guarantees under Hull-White rates, a correlated equity fund, Gompertz-Makeham mortality and dynamic lapses. A NumPy fp64 reference, PyTorch and a fused Triton kernel share one counter-based Philox stream, bitwise identical across all three, so the GPU is checked path for path against the CPU. The kernel keeps every path in registers for all 120 months and writes 28 bytes per path once, where torch.compile is memory-bound. Benchmarks only count when the GPU clock and temperature held. The model also runs live in the browser.',
          stats: [
            { value: '10.8×', label: 'faster than torch.compile with CUDA graphs, 4M paths, clock-gated' },
            { value: '69 / 69', label: 'GPU-vs-CPU checks passing, with tolerances fixed from an error budget before the run' },
            { value: '82–150×', label: 'variance reduction from antithetics plus a Hull-White put control variate' },
          ],
          tech: ['Triton', 'PyTorch', 'NumPy', 'JavaScript'],
          links: [
            { label: 'Live demo', href: 'https://ps12007.github.io/segfund-mc/' },
            { label: 'Code', href: 'https://github.com/PS12007/segfund-mc' },
          ],
        },
        {
          title: 'tinyfuse',
          kind: 'Compilers',
          year: '2026',
          summary: 'A small ML compiler: ordinary Python in, fused and vectorized C out.',
          detail:
            'You write a model with a NumPy-like API. tinyfuse traces it into a graph, optimizes and fuses it, generates C with tiled, vectorized loops, compiles that with gcc and calls it through ctypes. It handles a two-layer MLP and a full transformer block: multi-head attention, GELU MLP, layernorm and residuals.',
          stats: [
            { value: '2–7×', label: 'faster than PyTorch eager on elementwise-heavy code, where fusion has the most to do' },
            { value: '1.2–1.7×', label: 'faster than the same model in NumPy, on one core' },
            { value: '345', label: 'tests' },
          ],
          tech: ['Python', 'C', 'Compilers'],
          links: [{ label: 'Code', href: 'https://github.com/PS12007/tinyfuse' }],
        },
        {
          title: 'kernelport',
          kind: 'Tooling',
          year: '2026',
          summary: 'Bring CUDA-only kernels to Mac, AMD, browsers and CPU, with proof they are correct.',
          detail:
            'An MCP server, agent skill and CLI. A coding agent writes the ports; kernelport runs them on real hardware and checks each one against a reference that was itself validated against the original CUDA kernel. A port is only reported as PASS if its current code ran on real hardware and matched. The agent never sets tolerances and never edits the frozen reference, and those rules are enforced in the tools.',
          stats: [
            { value: '4', label: 'backends verified on real hardware: Triton, CPU, WebGPU and Metal' },
            { value: '6', label: 'failed verification attempts allowed per port before it is stopped' },
          ],
          tech: ['Python', 'MCP', 'CUDA', 'Triton', 'WebGPU', 'Metal'],
          links: [
            { label: 'WebGPU demo', href: 'https://ps12007.github.io/kernelport/web/' },
            { label: 'Code', href: 'https://github.com/PS12007/kernelport' },
          ],
        },
        {
          title: 'Locret for llama.cpp',
          kind: 'Inference',
          year: '2026',
          summary: 'Small trained heads that decide which KV-cache entries are worth keeping, ported into llama.cpp.',
          detail:
            'Retaining heads score cached tokens so chunked prefill can evict the least useful ones instead of the oldest. The integration is designed against llama.cpp’s real eval-callback and memory APIs, read from source rather than guessed at.',
          stats: [{ value: '4.6e-7', label: 'max absolute error of the C++ retaining head against its PyTorch reference' }],
          tech: ['C++', 'llama.cpp', 'PyTorch'],
          links: [{ label: 'Code', href: 'https://github.com/PS12007/locret-llamacpp' }],
        },
      ],
    },
    {
      group: 'Research',
      items: [
        {
          title: 'Latent Cartographer',
          kind: 'Interpretability',
          year: '2026',
          summary: 'A transformer that has only ever read N, E, S, W builds a map of a maze it has never seen.',
          detail:
            'A 0.8M-parameter GPT is trained on random walks through a maze it is never shown. Because the walker is uniform, the best possible predictor is an exact Bayesian filter, so the model can be graded against the optimal loss and the exact belief it ought to hold. It gets within a hair of both. Steering its internal belief to each cell in turn and recording which moves it then allows redraws the whole maze from the network alone.',
          stats: [
            { value: '112 / 112', label: 'interior maze edges recovered from the model by steering, environment never consulted' },
            { value: '98.7%', label: 'linear readout of the current cell, against 6% for a random-init network' },
            { value: '0.9929', label: 'nats next-move loss, where Bayes-optimal is 0.9888' },
          ],
          tech: ['PyTorch', 'Mechanistic interpretability', 'JavaScript'],
          links: [
            { label: 'Live demo', href: 'https://ps12007.github.io/latent-cartographer/' },
            { label: 'Code', href: 'https://github.com/PS12007/latent-cartographer' },
          ],
        },
        {
          title: 'kv-notary',
          kind: 'ML security',
          year: '2026',
          summary: 'Can you trust a KV cache you did not compute? Forging one column flips the answer; recomputing a few catches it.',
          detail:
            'LLM serving now ships KV caches between machines, and whichever node reads one trusts that it encodes the tokens it came with. Nothing checks. kv-notary shows that an untrusted prefill worker can nudge one token at one layer and flip the answer, and that a cache is honest if and only if every column agrees with its recomputation, which costs one token per column. Checking where the question actually reads catches most forgeries for a handful of columns.',
          stats: [
            { value: '86%', label: 'of answers flipped to the attacker’s value by one forged column of about 440, Llama-3.2-1B' },
            { value: '91%', label: 'of forgeries caught by checking only the 8 most-read columns' },
            { value: '0', label: 'honest caches flagged' },
          ],
          tech: ['PyTorch', 'Transformers', 'Security'],
          links: [
            { label: 'Live demo', href: 'https://ps12007.github.io/kv-notary/' },
            { label: 'Code', href: 'https://github.com/PS12007/kv-notary' },
          ],
        },
        {
          title: 'Noether Check',
          kind: 'Scientific ML',
          year: '2026',
          summary: 'Neural PDE surrogates break conservation laws. That is why their long rollouts fail, and how you can tell that they have.',
          detail:
            'A controlled zoo of 64 surrogates on KdV solitons and decaying 2D turbulence. One-step error, the thing models are ranked on, turns out to be anti-correlated with long-rollout error. Making the smallest change to the state that restores some conserved quantities after every step repairs the rollouts, and the quantities left unrestored act as an alarm that needs no reference solution.',
          stats: [
            { value: '−64%', label: 'median long-horizon error on KdV after projecting mass and momentum, helping all 36 models' },
            { value: '0.98', label: 'AUROC for flagging unphysical turbulence rollouts from the held-out enstrophy budget' },
            { value: '−0.48', label: 'Spearman correlation between one-step error and error at the end of the rollout' },
          ],
          tech: ['PyTorch', 'PDEs', 'FNO', 'U-Net'],
          links: [
            { label: 'Live demo', href: 'https://ps12007.github.io/noether-check/' },
            { label: 'Code', href: 'https://github.com/PS12007/noether-check' },
          ],
        },
        {
          title: 'Hans Hunter',
          kind: 'Medical AI',
          year: '2026',
          summary: 'Catching medical image classifiers that cheat, without knowing how they cheat.',
          detail:
            'Medical models learn shortcuts: a hospital’s corner marker, a ruler, a scanner’s colour cast. Hans Hunter audits a trained model by asking for the cheapest single edit that makes healthy scans look diseased, then checks whether that edit still works on images from an unrelated dataset. A shortcut key does; a disease imitation does not. Built on a benchmark of 300 models with known shortcuts, audited blind.',
          stats: [
            { value: '0.94', label: 'AUROC detecting shortcut models with the context test, skin lesions' },
            { value: '45% → 0%', label: 'false alarms from an invisible pattern after trigger scrubbing' },
            { value: '300', label: 'models trained with known shortcuts and audited blind' },
          ],
          tech: ['PyTorch', 'MedMNIST', 'Robustness'],
          links: [
            { label: 'Live demo', href: 'https://ps12007.github.io/hans-hunter/' },
            { label: 'Code', href: 'https://github.com/PS12007/hans-hunter' },
          ],
        },
        {
          title: 'Arecibo Zero',
          kind: 'Emergent communication',
          year: '2026',
          summary: 'How should we write to a mind that knows nothing? Interstellar message designs, tested on networks that start from zero.',
          detail:
            'Every first-contact message starts by teaching numbers, and every one rests on untested guesses about what a receiver will find obvious. Here a sender writes a message under a fixed bit budget, and a randomly initialised transformer or LSTM is trained on that one message and nothing else, then examined on sums it has never seen. Writing the least significant digit first wins in every base, and binary the way Arecibo sent it never reaches 50%.',
          stats: [
            { value: '87% vs 27%', label: 'held-out sums, least-significant digit first against most-significant, base 4' },
            { value: '47 of 49', label: 'matched cells where LSB-first is ahead, sign test p = 4×10⁻¹²' },
            { value: '434', label: 'receivers trained from scratch on one laptop GPU' },
          ],
          tech: ['PyTorch', 'Transformers', 'Genetic search'],
          links: [
            { label: 'Live demo', href: 'https://ps12007.github.io/arecibo-zero/' },
            { label: 'Code', href: 'https://github.com/PS12007/arecibo-zero' },
          ],
        },
      ],
    },
    {
      group: 'Also',
      items: [
        {
          title: 'Aegis',
          kind: 'AI safety',
          year: '2026',
          badge: 'Hack Western 13 winner',
          summary: 'An AI phone line for pharmacies. The AI can be fooled; the pharmacy can’t. Won Best Use of Auth0 at Hack Western 13.',
          detail:
            'A voice agent calls patients before their medication runs out, handles routine refill steps and sends exceptions to a pharmacist. It can act only by pressing one of 12 buttons, and a control layer decides each press in code, so a successful prompt injection still cannot do anything the rules forbid. Every spoken sentence passes through a speech guard as well. I built the lock: the shared contract, the control layer, the speech guard, the hammer that throws hostile button sequences at it, the stage view and phone latency. Four people built it in one weekend, each running a coding agent on one role.',
          stats: [
            { value: '12', label: 'buttons the agent can press, and nothing else, each checked against rules in code' },
            { value: '0 / 28', label: 'scenarios where the live agent broke a rule; it reached the expected outcome on 16' },
            { value: '586 / 624', label: 'red-team attacks that beat the first speech guard, which is why speech is best effort and the buttons are the boundary' },
          ],
          tech: ['TypeScript', 'Next.js', 'Claude Agent SDK', 'Auth0', 'Twilio', 'ElevenLabs'],
          links: [
            { label: 'Live site', href: 'https://aegis-pharmacy-live-hw13.vercel.app/' },
            { label: 'Code', href: 'https://github.com/nishantshah0/Aegis-voice-agent' },
          ],
        },
        {
          title: 'Video to Humanoid',
          kind: 'Robotics',
          year: '2026',
          summary: 'A monocular video of a person in; a physically simulated Unitree G1 humanoid doing the same motion out.',
          detail:
            'Four stages, each verified before the next: recover SMPL-X motion from video, retarget it to the G1, then train a physics-based RL tracking policy so the robot balances through the motion instead of replaying joint angles into the floor. Stage 1 runs natively on Windows and an RTX 50-series GPU, which upstream does not support.',
          stats: [
            { value: '2m 44s', label: 'from an 8.5 s clip to a full SMPL-X motion solve, on a laptop running on battery' },
            { value: '1.2 cm', label: 'mean per-frame step over 255 frames, with zero body-shape drift' },
          ],
          tech: ['PyTorch', 'CUDA', 'SMPL-X', 'MuJoCo', 'RL'],
          links: [{ label: 'Code', href: 'https://github.com/PS12007/video-to-humanoid-mimicry' }],
        },
        {
          title: 'TermCinema',
          kind: 'Graphics',
          year: '2026',
          summary: 'Watch anything in a terminal, as sub-cell block art or as real pixels where the terminal allows.',
          detail:
            'Each character cell is treated as a tiny two-colour image, and the renderer picks the glyph and both colours that best reproduce the source pixels. Encoding is vectorised in NumPy and diffed against what the terminal already shows. Audio is the master clock, so sync holds and late frames drop rather than drag. Twelve renderers, including kitty, iTerm2 and sixel graphics.',
          stats: [
            { value: '~236 fps', label: 'half-block render and encode ceiling at 160×45 cells, truecolor' },
            { value: '0 B', label: 'written for a frame the terminal is already showing' },
          ],
          tech: ['Python', 'NumPy', 'numba', 'FFmpeg'],
          links: [{ label: 'Code', href: 'https://github.com/PS12007/termcinema' }],
        },
        {
          title: 'Artists With Souls',
          kind: 'Adversarial ML',
          year: '2025',
          summary: 'Perturbations that leave artwork looking the same to people and useless to the models that scrape it.',
          detail:
            'FGSM and PGD attacks against a ResNet-50 proxy disrupt feature extraction while preserving how the image looks, with Grad-CAM showing the model’s attention slide off the subject once protection is applied. Perturbations are computed on a downscaled 512px pass and blended back to full resolution.',
          stats: [{ value: '>90%', label: 'less processing time from attacking the 512px proxy instead of the full image' }],
          tech: ['PyTorch', 'Flask', 'Celery', 'Redis'],
          links: [{ label: 'Code', href: 'https://github.com/PS12007/Artists-with-souls---AWS' }],
        },
        {
          title: 'SurFur',
          kind: 'Full stack',
          year: '2025',
          badge: 'Hackathon winner',
          summary: 'Food-surplus matching between donors and shelters. Won Hackathon Guelph.',
          detail:
            'A matching engine ranks shelters by proximity, urgency and capacity, with dietary-compatibility filtering. Built end to end under hackathon time: REST API, PostgreSQL data model, and a Next.js front end with a live map and urgency alerts.',
          stats: [{ value: '90 min', label: 'before an unclaimed listing automatically re-broadcasts' }],
          tech: ['Next.js', 'TypeScript', 'PostgreSQL', 'Leaflet'],
          links: [{ label: 'Code', href: 'https://github.com/PS12007/surfur' }],
        },
      ],
    },
  ],

  experience: [
    {
      role: 'Founder',
      org: 'Stealth startup',
      period: '2025 — now',
      notes: [
        'Leading product, design and engineering end to end for an early-stage software company.',
        'Shipping and killing MVPs quickly, cutting whatever does not hold up under real usage.',
      ],
    },
    {
      role: 'Software Engineering Intern',
      org: 'Avante Pathways',
      period: 'Apr — Sep 2025',
      notes: [
        'Built internal tools for data tracking and workflow automation, replacing manual processes.',
        'Built AI tooling for resume writing and college application workflows on the OpenAI API, across Python, React and Node.js.',
      ],
    },
    {
      role: 'Freelance Developer',
      org: 'Independent',
      period: '2023 — now',
      notes: ['Designed and shipped websites and web applications for local and online clients, scoped directly with them.'],
    },
  ],

  education: [
    {
      role: 'BESc, Mechatronic Systems Engineering',
      org: 'Western University',
      period: 'Expected 2029',
      notes: ['GPA 3.9 / 4.0 · Dean’s Honour List, 2025–26'],
    },
    {
      role: 'HBA, Advanced Entry Opportunity',
      org: 'Ivey Business School',
      period: 'Dual degree',
      notes: ['Merit-based early admission'],
    },
  ],

  awards: [
    {
      role: '1st place, Western × Canadian Nuclear Laboratories Case Competition',
      period: '2025',
      notes: ['Multi-layer radiation shielding for a lunar base, pitched to a CNL engineering panel.'],
    },
    { role: 'Won multiple hackathons', period: '' },
  ],

  skills: [
    { group: 'Languages', items: ['Python', 'C++', 'C', 'Rust', 'Go', 'TypeScript', 'Java', 'MATLAB', 'SQL'] },
    { group: 'GPU & ML', items: ['CUDA', 'Triton', 'PyTorch', 'llama.cpp', 'Quantization', 'Interpretability', 'Adversarial ML'] },
    { group: 'Systems', items: ['Profiling & tracing', 'Benchmark design', 'Distributed consensus', 'Emulation', 'WebAssembly', 'Compilers'] },
    { group: 'Web & data', items: ['React', 'Next.js', 'Node.js', 'Flask', 'PostgreSQL', 'Redis'] },
  ],
};
