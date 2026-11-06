//! Typed coordinates, read as the web's coordinates.js reads them: decimal
//! pairs, and degree/minute/second forms with hemisphere letters before or
//! after either value, in either order.

/// The text is a coordinate but out of range (or malformed degrees).
#[derive(Debug, PartialEq, Eq)]
pub struct Invalid;

pub const INVALID_MESSAGE: &str =
    "Invalid coordinates: latitude must be within ±90°, longitude within ±180°, and minutes/seconds below 60.";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Style {
    Prefix,
    Suffix,
    Plain,
}

struct Angle {
    style: Style,
    hemisphere: Option<char>,
    sign: Option<char>,
    degrees: f64,
    minutes: f64,
    seconds: f64,
}

struct Cursor<'a> {
    text: &'a [char],
    at: usize,
}

impl Cursor<'_> {
    fn peek(&self) -> Option<char> {
        self.text.get(self.at).copied()
    }
    fn space(&mut self) {
        while self.peek().is_some_and(char::is_whitespace) {
            self.at += 1;
        }
    }
    fn eat(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.at += 1;
            true
        } else {
            false
        }
    }
    /// An unsigned decimal: `12`, `12.5` or `.5`.
    fn number(&mut self) -> Option<f64> {
        let start = self.at;
        while self.peek().is_some_and(|c| c.is_ascii_digit()) {
            self.at += 1;
        }
        let whole = self.at > start;
        if self.peek() == Some('.') {
            let dot = self.at;
            self.at += 1;
            let frac = self.at;
            while self.peek().is_some_and(|c| c.is_ascii_digit()) {
                self.at += 1;
            }
            if self.at == frac {
                self.at = dot;
            }
        }
        if !whole && self.at == start {
            return None;
        }
        self.text[start..self.at].iter().collect::<String>().parse().ok()
    }
    fn hemisphere(&mut self) -> Option<char> {
        let c = self.peek()?.to_ascii_uppercase();
        if "NSEW".contains(c) {
            self.at += 1;
            Some(c)
        } else {
            None
        }
    }
    /// A signed magnitude with optional °, ′ and ″ parts.
    fn magnitude(&mut self) -> Option<(Option<char>, f64, f64, f64)> {
        let sign = match self.peek() {
            Some(c @ ('+' | '-')) => {
                self.at += 1;
                Some(c)
            }
            _ => None,
        };
        let degrees = self.number()?;
        let (mut minutes, mut seconds) = (0.0, 0.0);
        let mark = self.at;
        self.space();
        if self.eat('°') {
            let after = self.at;
            self.space();
            match self.number() {
                Some(m) => {
                    self.space();
                    if self.eat('\'') {
                        minutes = m;
                        let after_min = self.at;
                        self.space();
                        match self.number() {
                            Some(s) => {
                                self.space();
                                if self.eat('"') {
                                    seconds = s;
                                } else {
                                    self.at = after_min;
                                }
                            }
                            None => self.at = after_min,
                        }
                    } else {
                        self.at = after;
                    }
                }
                None => self.at = after,
            }
        } else {
            self.at = mark;
        }
        Some((sign, degrees, minutes, seconds))
    }
    fn angle(&mut self) -> Option<Angle> {
        let start = self.at;
        if let Some(h) = self.hemisphere() {
            self.space();
            if let Some((sign, degrees, minutes, seconds)) = self.magnitude() {
                return Some(Angle { style: Style::Prefix, hemisphere: Some(h), sign, degrees, minutes, seconds });
            }
            self.at = start;
            return None;
        }
        let (sign, degrees, minutes, seconds) = self.magnitude()?;
        let before = self.at;
        self.space();
        if let Some(h) = self.hemisphere() {
            return Some(Angle { style: Style::Suffix, hemisphere: Some(h), sign, degrees, minutes, seconds });
        }
        self.at = before;
        Some(Angle { style: Style::Plain, hemisphere: None, sign, degrees, minutes, seconds })
    }
}

fn valid(lat: f64, lng: f64) -> Result<Option<(f64, f64)>, Invalid> {
    if lat.is_finite() && lng.is_finite() && lat.abs() <= 90.0 && lng.abs() <= 180.0 {
        Ok(Some((lat, lng)))
    } else {
        Err(Invalid)
    }
}

/// `(lat, lng)` for coordinate text, None for other text, Invalid for a
/// coordinate out of range.
pub fn parse(value: &str) -> Result<Option<(f64, f64)>, Invalid> {
    let text: Vec<char> = value
        .trim()
        .chars()
        .map(|c| match c {
            'º' | '˚' => '°',
            '′' | '’' | '‘' | '`' => '\'',
            '″' | '“' | '”' => '"',
            '−' | '–' => '-',
            c => c,
        })
        .collect();
    if text.is_empty() {
        return Ok(None);
    }
    // A decimal pair: two signed numbers, comma or space between.
    {
        let mut c = Cursor { text: &text, at: 0 };
        let signed = |c: &mut Cursor<'_>| {
            let negative = if c.eat('-') {
                true
            } else {
                c.eat('+');
                false
            };
            c.number().map(|n| if negative { -n } else { n })
        };
        if let Some(a) = signed(&mut c) {
            c.space();
            let comma = c.eat(',');
            c.space();
            if (comma || c.at > 0 && text[c.at - 1].is_whitespace())
                && let Some(b) = signed(&mut c)
                && c.at == text.len()
            {
                return valid(a, b);
            }
        }
    }
    let pair = (|| {
        let mut c = Cursor { text: &text, at: 0 };
        let first = c.angle()?;
        let before = c.at;
        c.space();
        let separated = c.eat(',') || c.eat(';');
        c.space();
        let spaced = c.at > before;
        let second = c.angle()?;
        (c.at == text.len()).then_some(())?;
        let plain = first.style == Style::Plain || second.style == Style::Plain;
        if plain {
            // Plain angles pair only with each other, need a degree sign, and
            // a separator or space between them.
            (first.style == second.style && text.contains(&'°') && (separated || spaced)).then_some(())?;
        }
        Some((first, second))
    })();
    let Some((first, second)) = pair else {
        let shaped = text.iter().all(|c| c.is_ascii_digit() || " \t+-.°,;'\"NSEWnsew".contains(*c));
        let marked = text.iter().any(|c| "°'\"".contains(*c))
            || text.windows(2).any(|w| {
                (w[0].is_ascii_digit() && "NSEWnsew".contains(w[1]))
                    || ("NSEWnsew".contains(w[0]) && w[1].is_ascii_digit())
            })
            || text.windows(3).any(|w| {
                w[1] == ' '
                    && ((w[0].is_ascii_digit() && "NSEWnsew".contains(w[2]))
                        || ("NSEWnsew".contains(w[0]) && w[2].is_ascii_digit()))
            });
        return if shaped && marked { Err(Invalid) } else { Ok(None) };
    };
    let read = |a: &Angle| -> Result<(f64, Option<bool>), Invalid> {
        if a.minutes >= 60.0 || a.seconds >= 60.0 {
            return Err(Invalid);
        }
        if let Some(h) = a.hemisphere
            && ((a.sign == Some('-') && "NE".contains(h)) || (a.sign == Some('+') && "SW".contains(h)))
        {
            return Err(Invalid);
        }
        let negative = a.hemisphere.map_or(a.sign == Some('-'), |h| "SW".contains(h));
        let value = (a.degrees + a.minutes / 60.0 + a.seconds / 3600.0) * if negative { -1.0 } else { 1.0 };
        Ok((value, a.hemisphere.map(|h| "NS".contains(h))))
    };
    let (v1, lat1) = read(&first)?;
    let (v2, lat2) = read(&second)?;
    let lat1 = lat1.unwrap_or(lat2 != Some(true));
    let lat2 = lat2.unwrap_or(!lat1);
    if lat1 == lat2 {
        return Err(Invalid);
    }
    if lat1 { valid(v1, v2) } else { valid(v2, v1) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_web_forms() {
        assert_eq!(parse("47.66, -117.43"), Ok(Some((47.66, -117.43))));
        assert_eq!(parse("47.66 -117.43"), Ok(Some((47.66, -117.43))));
        let (lat, lng) = parse("47°39'36\"N 117°25'48\"W").unwrap().unwrap();
        assert!((lat - 47.66).abs() < 1e-9 && (lng + 117.43).abs() < 1e-9);
        assert_eq!(parse("W117.43, N47.66"), Ok(Some((47.66, -117.43))));
        assert_eq!(parse("47.66N, 117.43W"), Ok(Some((47.66, -117.43))));
        assert_eq!(parse("47° 117°"), Ok(Some((47.0, 117.0))));
        assert_eq!(parse("Spokane"), Ok(None));
        assert_eq!(parse("Route 66"), Ok(None));
        assert_eq!(parse("95, 10"), Err(Invalid));
        assert_eq!(parse("47°61'N 117°W"), Err(Invalid));
        assert_eq!(parse("47N 117N"), Err(Invalid));
    }
}
