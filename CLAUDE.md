# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Jekyll-based personal portfolio website for CYBER_AMADEUS (Jimin Lee), hosted on GitHub Pages at `cyber-amadeus.github.io`. The site uses Tailwind CSS via CDN with a cyberpunk/matrix aesthetic (primary color: #00FF41).

## Build & Development

**Local development** (requires Ruby 3.x):
```bash
bundle install
bundle exec jekyll serve
```

**Deployment**: Push to `main` branch automatically triggers GitHub Pages build. No manual build step required.

## Architecture

### Jekyll Structure
- `_config.yml` - Site configuration, navigation menu, social links
- `_layouts/default.html` - Base HTML template with Tailwind config and dark mode toggle
- `_includes/header.html` - Navigation header (uses `site.navigation` from config)
- `_includes/footer.html` - Footer with social links (uses `site.social` from config)

### Pages
- `index.html` - Home page with profile summary
- `about.html` - Detailed bio, skills, experience, education, awards
- `publications.html` - Academic publications (Domestic Conference section)
- `projects.html` - Project portfolio with images
- `cve-kve.html` - Vulnerability disclosures (KVE entries with stats)
- `contact.html` - Contact form and links

### Assets
- `assets/images/` - Profile and project images (compress to <1MB before adding)

## Key Patterns

**Adding navigation items**: Edit `_config.yml` navigation array, header automatically updates.

**Image handling**: Use `sips` to compress images:
```bash
sips -s format jpeg -s formatOptions 70 -Z 800 input.png --out assets/images/output.jpg
```

**Liquid templating**: Pages use Jekyll/Liquid syntax like `{{ '/path' | relative_url }}` for URLs.

**Dark mode**: Controlled via `dark` class on `<html>`, toggled by JavaScript in default layout.
