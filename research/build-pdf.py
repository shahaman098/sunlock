import re, sys, html

def inline(s):
    s = html.escape(s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', s)
    return s

def convert(md):
    out, i, lines = [], 0, md.split('\n')
    in_code = False
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('```'):
            if in_code:
                out.append('</pre>'); in_code = False
            else:
                out.append('<pre>'); in_code = True
            i += 1; continue
        if in_code:
            out.append(html.escape(ln)); i += 1; continue
        if re.match(r'^\|', ln) and i + 1 < len(lines) and re.match(r'^\|[\s:\-|]+\|', lines[i+1]):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')])
                i += 1
            head, body = rows[0], rows[2:]
            out.append('<table><thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in head) + '</tr></thead><tbody>')
            for r in body:
                out.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>')
            out.append('</tbody></table>')
            continue
        m = re.match(r'^(#{1,4})\s+(.*)', ln)
        if m:
            lvl = len(m.group(1))
            out.append(f'<h{lvl}>{inline(m.group(2))}</h{lvl}>'); i += 1; continue
        if ln.strip() == '---':
            out.append('<hr/>'); i += 1; continue
        if ln.startswith('- '):
            out.append('<ul>')
            while i < len(lines) and lines[i].startswith('- '):
                out.append(f'<li>{inline(lines[i][2:])}</li>'); i += 1
            out.append('</ul>'); continue
        if ln.strip() == '':
            i += 1; continue
        para = [ln]
        i += 1
        while i < len(lines) and lines[i].strip() and not lines[i].startswith(('#','-','|','```')):
            para.append(lines[i]); i += 1
        out.append('<p>' + inline(' '.join(para)) + '</p>')
    return '\n'.join(out)

src = open(sys.argv[1]).read()
body = convert(src)
html_doc = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 18mm 16mm; }}
body {{ font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt; line-height: 1.5; color: #111; max-width: 175mm; margin: 0 auto; }}
h1 {{ font-size: 17pt; line-height: 1.25; margin: 0 0 6pt; }}
h2 {{ font-size: 12.5pt; margin: 16pt 0 5pt; border-bottom: 0.5pt solid #bbb; padding-bottom: 2pt; }}
h3 {{ font-size: 11pt; margin: 12pt 0 4pt; }}
p {{ margin: 0 0 6pt; text-align: justify; }}
table {{ border-collapse: collapse; width: 100%; margin: 7pt 0 10pt; font-size: 9pt; }}
th, td {{ border: 0.5pt solid #bbb; padding: 3pt 4pt; text-align: left; }}
th {{ background: #eee; }}
code, pre {{ font-family: Menlo, monospace; font-size: 8.5pt; background: #f4f4f4; }}
pre {{ padding: 6pt; white-space: pre-wrap; }}
hr {{ border: none; border-top: 0.5pt solid #ccc; margin: 12pt 0; }}
ul {{ margin: 0 0 6pt 16pt; }}
</style></head><body>{body}</body></html>"""
open(sys.argv[2], 'w').write(html_doc)
print("html written", len(html_doc))
