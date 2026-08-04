/**
 * The PDF's "Character Consistency Formula" — appended verbatim to every image/video template
 * that opts in (`appendConsistencyFormula: true`) so it is defined once, not duplicated per template.
 */
export const CHARACTER_CONSISTENCY_FORMULA = `
Maintain the exact same character appearance across every image and video.
Identical facial features.
Same hairstyle.
Same clothes.
Same body proportions.
Same colors.
Same accessories.
{{style}}-quality 3D animation.
Ultra detailed.
Cinematic lighting.
Professional rendering.
{{aspectRatio}}
Do not change the character design.
`.trim();
