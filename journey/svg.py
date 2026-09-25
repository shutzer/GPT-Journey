"""Allow-list the model's SVG down to inert drawing markup before it is ever served."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

_ALLOWED_TAGS = {
    "svg", "g", "defs", "title", "desc", "symbol", "use", "path", "rect", "circle", "ellipse",
    "line", "polyline", "polygon", "linearGradient", "radialGradient", "stop", "pattern",
    "clipPath", "mask", "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix",
    "feComposite", "feMerge", "feMergeNode", "feFlood", "feTurbulence", "feDisplacementMap",
    "feMorphology", "feDropShadow", "feComponentTransfer", "feFuncA", "feFuncR", "feFuncG",
    "feFuncB", "feSpecularLighting", "feDiffuseLighting", "fePointLight", "feDistantLight",
    "feSpotLight", "style",
}
_EXTERNAL_URL = re.compile(r"url\(\s*['\"]?(?!#)", re.I)
_SVG_BLOCK = re.compile(r"<svg\b.*</svg>", re.S | re.I)

ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)


class InvalidSVG(ValueError):
    pass


def sanitize_svg(raw: str) -> str:
    match = _SVG_BLOCK.search(raw)
    if not match:
        raise InvalidSVG("no <svg> element in response")
    source = match.group(0)
    if re.search(r"<!(DOCTYPE|ENTITY)", source, re.I):
        raise InvalidSVG("DTDs are not allowed")
    if "xmlns=" not in source.split(">", 1)[0]:
        source = source.replace("<svg", f'<svg xmlns="{SVG_NS}"', 1)
    try:
        root = ET.fromstring(source)
    except ET.ParseError as exc:
        raise InvalidSVG(f"unparseable SVG: {exc}") from exc
    if _local(root.tag) != "svg":
        raise InvalidSVG("root element is not <svg>")
    _clean(root)
    root.set("preserveAspectRatio", "xMidYMid slice")
    return ET.tostring(root, encoding="unicode")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _clean(el: ET.Element) -> None:
    for child in list(el):
        if not isinstance(child.tag, str) or _local(child.tag) not in _ALLOWED_TAGS:
            el.remove(child)
        elif _local(child.tag) == "style" and (
            "@import" in (child.text or "") or _EXTERNAL_URL.search(child.text or "")
        ):
            el.remove(child)
        else:
            _clean(child)
    for name, value in list(el.attrib.items()):
        local = _local(name).lower()
        if local.startswith("on"):
            del el.attrib[name]
        elif local == "href" and not value.strip().startswith("#"):
            del el.attrib[name]
        elif _EXTERNAL_URL.search(value):
            del el.attrib[name]
