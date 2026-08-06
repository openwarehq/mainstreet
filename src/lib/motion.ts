/**
 * The motion layer, injected into every page.
 *
 * These pages ship no JavaScript — not as a stylistic preference but because
 * the audit rejects it, and because a single file you can email to somebody
 * should not need a runtime to show an address. That used to mean no motion at
 * all. It does not any more: scroll-driven animations are a CSS feature now, so
 * a page can reveal as it scrolls, parallax its hero and run a progress bar
 * without a line of script.
 *
 * The reason this is *injected* rather than asked for in the prompt is that the
 * two things most likely to be got wrong are the two that matter most, and
 * neither is a design decision:
 *
 * 1. **Reduced motion.** Vestibular disorders make unstoppable movement a real
 *    harm, not a taste question. Everything here is inert under
 *    `prefers-reduced-motion: reduce`.
 *
 * 2. **Degrading.** The naive way to write a scroll reveal is `opacity: 0` plus
 *    an animation that restores it — which in any browser without scroll
 *    timelines leaves the entire page invisible. Every scroll-driven rule below
 *    sits inside `@supports (animation-timeline: view())`, so a browser that
 *    cannot animate simply shows the content.
 *
 * The designer applies classes. The guards are not theirs to forget.
 */

/** The class list, as documented to whoever is designing the page. */
export const MOTION_DOC = `Motion classes are available on every page — the stylesheet implementing them is added for you, so use the class and do not reimplement it:

- class="m-bar"        an empty <div> as the first child of <body>: a scroll progress bar across the top
- class="m-in"         entrance on load: fade and rise. Add m-in-2 … m-in-6 alongside it to stagger
- class="m-mask"       on a block, with class="m-line" on the child: the child rises out from behind a mask
- class="m-rise"       reveals as it scrolls into view — fade and rise. The workhorse; put it on sections
- class="m-fade"       reveals as it scrolls into view — fade only, no movement
- class="m-wipe"       reveals as it scrolls into view — a clip-path wipe upward. Good on images and bands
- class="m-stagger"    on a container: its direct children reveal one after another as it scrolls in
- class="m-parallax"   on an image inside a position:relative, overflow:hidden box: drifts as you scroll
- class="m-aurora"     on a decorative colour field: drifts and breathes, slowly, forever
- class="m-float"      on a panel: rises and settles, slowly, forever. m-float-2 offsets a second one
- class="m-hue"        on a colour field: its hue shifts as the page scrolls
- class="m-grow"       on a rule or underline: draws itself out from the left as it scrolls in
- class="m-lift"       hover: rises slightly. For cards and buttons
- class="m-zoom"       on a figure wrapping an <img>: the image scales slowly on hover
- class="m-line-in"    hover: an underline wipes in from the left. For inline links
- class="m-draw"       on drawn lettering: it writes itself on, stroke by stroke
- class="m-scribble"   on a {{UNDERLINE}}: the scribble draws as it scrolls into view
- class="m-trace"      on a {{TRACE}}: the long line draws in step with the page scroll

You may write additional @keyframes of your own. If you do, put them inside
@media (prefers-reduced-motion: no-preference) and, if they are scroll-driven,
inside @supports (animation-timeline: view()) as well.`;

export const MOTION_CSS = `
/* ── motion ───────────────────────────────────────────────────────────────
   Injected. Scroll-driven rules are behind @supports so a browser without
   scroll timelines shows the content rather than hiding it, and everything is
   inert under prefers-reduced-motion. */

@keyframes m-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes m-rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes m-fade{from{opacity:0}to{opacity:1}}
@keyframes m-wipe{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes m-lineup{from{transform:translateY(108%)}to{transform:none}}
@keyframes m-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes m-drift{from{transform:translate3d(0,-5%,0) scale(1.14)}to{transform:translate3d(0,5%,0) scale(1.14)}}
@keyframes m-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes m-aurora{
  0%{transform:translate3d(-3%,-2%,0) scale(1.15) rotate(0deg)}
  50%{transform:translate3d(3%,2%,0) scale(1.22) rotate(4deg)}
  100%{transform:translate3d(-3%,-2%,0) scale(1.15) rotate(0deg)}
}
@keyframes m-float{0%{transform:translateY(0)}50%{transform:translateY(-9px)}100%{transform:translateY(0)}}
@keyframes m-hue{from{filter:hue-rotate(0deg)}to{filter:hue-rotate(26deg)}}
@keyframes m-draw{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}

/* Hover and focus movement is safe everywhere: it is short, and it only
   happens because somebody asked for it. */
.m-lift{transition:transform .38s cubic-bezier(.2,.7,.2,1),box-shadow .38s cubic-bezier(.2,.7,.2,1)}
.m-lift:hover,.m-lift:focus-visible{transform:translateY(-4px)}
.m-zoom{overflow:hidden}
.m-zoom img{transition:transform .9s cubic-bezier(.2,.7,.2,1)}
.m-zoom:hover img,.m-zoom:focus-within img{transform:scale(1.05)}
.m-line-in{
  background-image:linear-gradient(currentColor,currentColor);
  background-size:0% 1px;background-position:0 100%;background-repeat:no-repeat;
  transition:background-size .45s cubic-bezier(.2,.7,.2,1);
  text-decoration:none;
}
.m-line-in:hover,.m-line-in:focus-visible{background-size:100% 1px}

@media (prefers-reduced-motion: no-preference){

  /* Entrance on load. Plain time-based animation, so it works everywhere. */
  .m-in{animation:m-in .85s cubic-bezier(.2,.75,.2,1) both}
  .m-in-2{animation-delay:.09s}
  .m-in-3{animation-delay:.18s}
  .m-in-4{animation-delay:.27s}
  .m-in-5{animation-delay:.36s}
  .m-in-6{animation-delay:.45s}

  /* A line of type rising out from behind its own mask.
     The padding is not decorative: overflow:hidden on a heading set at tight
     leading clips the descenders of y, g and p, and the mask has to be a hair
     taller than the text for that not to happen. The negative margin puts the
     space back so the layout does not move. */
  .m-mask{display:block;overflow:hidden;padding-bottom:.1em;margin-bottom:-.1em}
  .m-mask .m-line{display:block;animation:m-lineup 1.05s cubic-bezier(.19,.8,.2,1) both}
  .m-mask .m-line:nth-child(2){animation-delay:.08s}
  .m-mask .m-line:nth-child(3){animation-delay:.16s}
  .m-mask .m-line:nth-child(4){animation-delay:.24s}

  @supports (animation-timeline: view()){
    .m-rise,.m-fade,.m-wipe{animation:linear both;animation-timeline:view()}
    .m-rise{animation-name:m-rise;animation-range:entry 6% cover 30%}
    .m-fade{animation-name:m-fade;animation-range:entry 4% cover 26%}
    .m-wipe{animation-name:m-wipe;animation-range:entry 2% cover 34%}

    /* Children arrive one after another. With a view timeline a delay does
       nothing — each element has its own timeline — so the stagger comes from
       giving each child a longer range, which makes it finish later. */
    .m-stagger > *{animation:m-rise linear both;animation-timeline:view();animation-range:entry 6% cover 26%}
    .m-stagger > *:nth-child(2){animation-range:entry 6% cover 34%}
    .m-stagger > *:nth-child(3){animation-range:entry 6% cover 42%}
    .m-stagger > *:nth-child(4){animation-range:entry 6% cover 50%}
    .m-stagger > *:nth-child(5){animation-range:entry 6% cover 58%}
    .m-stagger > *:nth-child(6){animation-range:entry 6% cover 66%}

    .m-parallax{
      animation:m-drift linear both;animation-timeline:view();
      animation-range:cover 0% cover 100%;will-change:transform;
    }

    /* A scribbled flourish drawing itself as it comes into view. */
    .m-scribble path{
      stroke-dasharray:100;stroke-dashoffset:100;
      animation:m-draw linear both;animation-timeline:view();
      animation-range:entry 16% cover 40%;
    }

    /* The colour field shifts hue as the page scrolls. On a glass page this is
       what makes it read as lit rather than painted — the light behind the
       panels changes while the panels do not. */
    .m-hue{animation:m-hue linear both;animation-timeline:scroll(root)}

    .m-grow{
      transform-origin:0 50%;
      animation:m-grow linear both;animation-timeline:view();
      animation-range:entry 10% cover 36%;
    }
  }

  /* The drawn wordmark writes itself on, one stroke after another.
     Every path carries pathLength="100", so a single dasharray works for a
     hairline apostrophe and a whole capital W alike — no measuring, and
     therefore no script. The per-stroke delay comes from --i, set inline on
     each path by the generator. */
  .m-draw path{
    stroke-dasharray:100;stroke-dashoffset:100;
    animation:m-draw .58s cubic-bezier(.55,.05,.3,1) both;
    animation-delay:calc(var(--i,0) * .052s + .12s);
  }

  /* Ambient, unending, and therefore the two most likely to be unwelcome —
     both are off entirely under reduced motion, like everything else here. */
  .m-aurora{animation:m-aurora 34s ease-in-out infinite;will-change:transform}
  .m-float{animation:m-float 7s ease-in-out infinite}
  .m-float-2{animation-duration:9.5s;animation-delay:-2s}

  @supports (animation-timeline: scroll()){
    /* The long line down the page, drawn by the scroll itself. */
    .m-trace path{
      stroke-dasharray:100;stroke-dashoffset:100;
      animation:m-draw linear both;animation-timeline:scroll(root);
    }

    .m-bar{
      position:fixed;inset:0 0 auto 0;height:3px;z-index:9999;
      transform-origin:0 50%;transform:scaleX(0);pointer-events:none;
      background:var(--accent-2,var(--accent,currentColor));
      animation:m-progress linear both;animation-timeline:scroll(root);
    }
  }
}

/* Nothing moves for anybody who has asked for that. Not a soft version — none
   of it. The page still reads exactly the same. */
@media (prefers-reduced-motion: reduce){
  .m-draw path,.m-scribble path,.m-trace path{
    animation:none !important;stroke-dashoffset:0 !important;
  }
  .m-in,.m-rise,.m-fade,.m-wipe,.m-grow,.m-parallax,.m-aurora,.m-float,.m-hue,.m-stagger > *,.m-mask .m-line{
    animation:none !important;opacity:1 !important;transform:none !important;clip-path:none !important;
  }
  .m-lift,.m-zoom img,.m-line-in{transition:none !important}
  .m-bar{display:none}
}
`.trim();
