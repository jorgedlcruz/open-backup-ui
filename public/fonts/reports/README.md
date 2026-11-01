# Report fonts

PDF export loads these fonts from the application only when needed and embeds subsets in each downloaded PDF. No external font service is contacted.

- Noto Sans (Regular, Bold, Italic, BoldItalic): https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans
- Noto Sans Devanagari (Regular, Bold): https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSansDevanagari
- Noto Sans CJK JP (Regular, including Chinese/Japanese/Korean glyph coverage): https://github.com/notofonts/noto-cjk/tree/main/Sans/OTF/Japanese

The CJK font is loaded only for reports containing CJK characters. Its regular face is also used for emphasis; heading size and colour retain the hierarchy. The SIL Open Font License texts are included alongside the fonts.
