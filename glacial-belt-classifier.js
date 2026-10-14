/*
 * Clear Skies Portal — interpretable object-level moraine belt screen.
 * Scores rank morphology, not the probability or proof of glacial origin.
 * Initial physical thresholds need train/validation calibration; they are
 * not inferred from held-out regions. Compact hummocky zones are eligible.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CSPGlacialBeltClassifier = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_CONFIG = Object.freeze({
    minAreaM2: 20000,             // Hard reject smaller closed-mask zones (m2).
    minRaisedFraction: 0.3,       // Hard reject zones mostly below local TPI zero.
    minReliefM: 1,                // Hard reject p95-p05 elevation relief below 1 m.
    minHummockDensityPerKm2: 20,  // Distinct raised blobs per km2 for support.
    minKettleDensityPerKm2: 10,   // Closed depressions per km2 for support.
    minTextureScore: 0.4,        // Physical density-ramp texture needed for support.
    minMeanStageScore: 0.5,      // Mean stage-1 score inside the closed zone.
    minBeltElongation: 2,         // Optional belt-shape support; never a reject.
    maxBeltElongation: 12,        // Upper inclusive end of plausible belt band.
    highSolidity: 0.9,           // Smooth-blob penalty requires solidity >= this.
    lowTextureScore: 0.2,        // Smooth-blob penalty requires texture <= this.
    extremeRoughnessM: 15,       // Mean |LRM| in metres for weak landslide proxy.
    nearZeroKettleDensityPerKm2: 1, // Roughness penalty only with <= 1 pit per km2.
    hummockWeight: 0.25,          // Contribution for hummock density support.
    kettleWeight: 0.20,           // Contribution for closed-depression density.
    textureWeight: 0.25,          // Contribution for composite texture support.
    ridgeWeight: 0.15,            // Contribution for > 0 supported ridge segments.
    elongationWeight: 0.05,       // Small optional contribution for belt shape.
    stageWeight: 0.10,            // Contribution for mean stage-1 score support.
    smoothBlobPenalty: 0.35,      // Subtracted for high solidity with low texture.
    roughnessWithoutKettlesPenalty: 0.35, // Subtracted for extreme pit-free texture.
    likelyScore: 0.55,            // Inclusive likely score threshold.
    possibleScore: 0.25,          // Inclusive possible score threshold.
    allowLikely: true            // Caller can cap known coarse-filled DEMs.
  });

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function inRange(value, min, max) {
    return finite(value) && value >= min && value <= max;
  }
  function measurement(value, unit) {
    return finite(value) ? String(value) + (unit || "") : "missing/non-finite";
  }
  function resolveConfig(overrides) {
    if (overrides != null && (typeof overrides !== "object" || Array.isArray(overrides))) {
      throw new TypeError("config must be an object");
    }
    var config = Object.assign({}, DEFAULT_CONFIG);
    Object.keys(overrides || {}).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) {
        throw new TypeError("Unknown classifier config: " + key);
      }
      config[key] = overrides[key];
    });
    Object.keys(config).forEach(function (key) {
      if (key === "allowLikely") {
        if (typeof config[key] !== "boolean") throw new TypeError("allowLikely must be boolean");
      } else if (!finite(config[key]) || config[key] < 0) {
        throw new RangeError(key + " must be a finite non-negative number");
      }
    });
    ["minRaisedFraction", "minTextureScore", "minMeanStageScore", "highSolidity",
      "lowTextureScore", "likelyScore", "possibleScore"
    ].forEach(function (key) {
      if (config[key] > 1) throw new RangeError(key + " must be at most 1");
    });
    if (config.minAreaM2 <= 0 || config.minReliefM <= 0 ||
        config.minRaisedFraction <= 0 || config.minHummockDensityPerKm2 <= 0 ||
        config.minKettleDensityPerKm2 <= 0 || config.minTextureScore <= 0 ||
        config.minMeanStageScore <= 0 || config.extremeRoughnessM <= 0 ||
        config.minBeltElongation < 1 || config.maxBeltElongation < config.minBeltElongation ||
        config.lowTextureScore >= config.minTextureScore ||
        config.nearZeroKettleDensityPerKm2 >= config.minKettleDensityPerKm2 ||
        config.likelyScore <= config.possibleScore) {
      throw new RangeError("Physical minima must be positive; belt band, texture, kettle and verdict thresholds must be ordered");
    }
    return config;
  }

  function classify(zone, features, config) {
    zone = zone || {};
    features = features || {};
    var evidence = [], hardRejects = [], rawScore = 0;
    function record(key, detail, supports) {
      evidence.push({ key: key, detail: detail, supports: supports });
    }
    function contribute(key, detail, amount) {
      rawScore += amount;
      record(key, detail + "; score contribution " + (amount >= 0 ? "+" : "") + amount + ".",
        amount > 0 ? 1 : amount < 0 ? -1 : 0);
    }
    function physicalGate(key, value, minimum, unit, maximum) {
      var valid = finite(value) && value >= 0 && (maximum == null || value <= maximum);
      var rejected = !valid || value < minimum;
      var reason = !valid ? "invalid-" + key : "too-low-" + key;
      if (rejected) hardRejects.push(reason);
      record(key, "Measured " + key + " " + measurement(value, unit) + "; required >= " +
        minimum + unit + (maximum == null ? "" : " and <= " + maximum) + ". " +
        (rejected ? "Hard reject: " + reason + "." : "Physical gate passed."), rejected ? -1 : 0);
    }

    // Mandatory measurements fail closed. Missing/invalid optional evidence
    // stays neutral; never renormalize available context into stronger support.
    physicalGate("area", zone.areaM2, config.minAreaM2, " m2");
    physicalGate("raised-fraction", features.raisedFraction, config.minRaisedFraction, "", 1);
    physicalGate("relief", features.reliefM, config.minReliefM, " m");

    var hummocks = finite(features.hummockDensityPerKm2) &&
      features.hummockDensityPerKm2 >= config.minHummockDensityPerKm2;
    contribute("hummocks", "Hummock density " + measurement(features.hummockDensityPerKm2, " per km2") +
      "; support threshold >= " + config.minHummockDensityPerKm2 + " per km2",
      hummocks ? config.hummockWeight : 0);

    var kettleValid = finite(features.kettleDensityPerKm2) && features.kettleDensityPerKm2 >= 0;
    var kettles = kettleValid && features.kettleDensityPerKm2 >= config.minKettleDensityPerKm2;
    contribute("kettles", "Closed-depression density " + measurement(features.kettleDensityPerKm2, " per km2") +
      "; support threshold >= " + config.minKettleDensityPerKm2 + " per km2",
      kettles ? config.kettleWeight : 0);

    var textureValid = inRange(features.textureScore, 0, 1);
    var texture = textureValid && features.textureScore >= config.minTextureScore;
    contribute("texture", "Texture score " + measurement(features.textureScore) +
      "; support threshold >= " + config.minTextureScore +
      "; supplied physical density-ramp combination, not a per-view percentile" +
      (textureValid ? "" : "; unavailable/out of [0,1]"), texture ? config.textureWeight : 0);

    var ridges = Number.isInteger(features.ridgeSupport) && features.ridgeSupport > 0;
    contribute("ridge-support", "Supported ridge segment count " + measurement(features.ridgeSupport) +
      "; support requires an integer count > 0 of likely/possible ridges with centroids inside the zone",
      ridges ? config.ridgeWeight : 0);

    var elongated = inRange(zone.elongation, config.minBeltElongation, config.maxBeltElongation);
    contribute("belt-shape", "Elongation " + measurement(zone.elongation) +
      "; optional belt-plausible band [" + config.minBeltElongation + ", " + config.maxBeltElongation +
      "]; compact zones remain eligible for likely; elongation is never required",
      elongated ? config.elongationWeight : 0);

    var stageValid = inRange(features.meanStageScore, 0, 1);
    var stage = stageValid && features.meanStageScore >= config.minMeanStageScore;
    contribute("stage-score", "Mean stage-1 score " + measurement(features.meanStageScore) +
      "; support threshold >= " + config.minMeanStageScore +
      (stageValid ? "" : "; unavailable/out of [0,1]"), stage ? config.stageWeight : 0);

    var smooth = inRange(zone.solidity, 0, 1) && zone.solidity >= config.highSolidity &&
      textureValid && features.textureScore <= config.lowTextureScore;
    contribute("smooth-blob", "Solidity " + measurement(zone.solidity) +
      "; texture score " + measurement(features.textureScore) + "; smooth-blob penalty requires solidity >= " +
      config.highSolidity + " and texture <= " + config.lowTextureScore +
      "; solidity is the zone core's approximate hull ratio; smooth till plains/hills can mimic a belt",
      smooth ? -config.smoothBlobPenalty : 0);

    // Weakest rule: mean |LRM| depends on DEM resolution and analysis scale,
    // and real moraines can be very rough. Apply only with measured near-zero
    // depressions; missing kettle evidence does not establish their absence.
    var chaotic = finite(features.roughness) && features.roughness >= config.extremeRoughnessM &&
      kettleValid && features.kettleDensityPerKm2 <= config.nearZeroKettleDensityPerKm2;
    contribute("roughness-without-kettles", "Mean |LRM| " + measurement(features.roughness, " m") +
      "; closed-depression density " + measurement(features.kettleDensityPerKm2, " per km2") +
      "; penalty requires roughness >= " + config.extremeRoughnessM + " m and kettle density <= " +
      config.nearZeroKettleDensityPerKm2 + " per km2. Weakest rule: roughness depends on DEM resolution/scale" +
      " and rough moraines are possible; only measured pit-free chaotic texture suggests a landslide confuser",
      chaotic ? -config.roughnessWithoutKettlesPenalty : 0);

    record("data-quality", "allowLikely=" + config.allowLikely +
      (config.allowLikely ? "; no DEM quality supplied; caller must gate known coarse-filled data."
        : "; caller disabled likely (for example, known coarse-filled DEM)."), config.allowLikely ? 0 : -1);

    var score = Math.max(0, Math.min(1, rawScore));
    var verdict = "unsupported", decision;
    if (hardRejects.length) {
      score = 0;
      decision = "Hard rejects override the score: " + hardRejects.join(", ") + "; returned score 0";
    } else if (score + 1e-9 >= config.likelyScore && config.allowLikely) {
      verdict = "likely";
      decision = "Score >= likely threshold " + config.likelyScore + "; allowLikely=true";
    } else if (score + 1e-9 >= config.possibleScore) {
      verdict = "possible";
      decision = "Score >= possible threshold " + config.possibleScore +
        "; likely requires score >= " + config.likelyScore + " and allowLikely=true";
    } else {
      decision = "Score below possible threshold " + config.possibleScore;
    }
    record("decision", "Raw contribution sum " + rawScore + "; clamp to [0,1]; returned score " + score +
      ". " + decision + ". Verdict: " + verdict + ". Morphology screening only, not proof of glaciation.",
      verdict === "likely" ? 1 : verdict === "unsupported" ? -1 : 0);
    return { verdict: verdict, score: score, evidence: evidence, hardRejects: hardRejects };
  }

  function classifyZone(zone, features, config) {
    return classify(zone, features, resolveConfig(config));
  }

  // Preserve input order and return classification results without mutation.
  function classifyZones(zonesWithFeatures, config) {
    if (!Array.isArray(zonesWithFeatures)) throw new TypeError("zonesWithFeatures must be an array");
    var resolved = resolveConfig(config);
    return zonesWithFeatures.map(function (entry) {
      if (!entry || typeof entry !== "object" || !entry.zone ||
          (!entry.features && entry.features !== null)) {
        throw new TypeError("Each entry must contain {zone, features}");
      }
      return classify(entry.zone, entry.features, resolved);
    });
  }

  return Object.freeze({
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    classifyZone: classifyZone,
    classifyZones: classifyZones
  });
}));
