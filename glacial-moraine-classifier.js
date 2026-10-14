/*
 * Clear Skies Portal — interpretable object-level moraine morphology screen.
 * Scores rank morphology, not the probability or proof of glacial origin.
 * These initial physical thresholds need train/validation calibration; they
 * are not inferred from the spent calibration test regions.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CSPGlacialMoraineClassifier = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_CONFIG = Object.freeze({
    minLengthM: 150,             // Hard reject shorter skeleton paths (metres).
    minProminenceM: 1,           // Hard reject crests below this prominence (metres).
    minElongation: 2,            // Hard reject length / mean width below this ratio.
    strongProminenceM: 3,        // Crest prominence required for a likely verdict.
    highArcScore: 0.6,           // Minimum consistent, plausible-radius arc score.
    deadStraightArcScore: 0.1,   // Legacy low-arc descriptor; never proves straightness.
    maxStraightBendRad: Math.PI / 18, // Straight paths bend less than 10 degrees.
    minStraightChordRatio: 0.97, // Endpoint chord / length must exceed this ratio.
    minKettleCount: 2,          // Alternative to either density threshold below.
    minKettleDensityPerKm: 1,    // Closed depressions per km needed for support.
    minKettleDensityPerKm2: 20,  // Closed depressions per square km for support.
    minApronFlatFraction: 0.65,  // Minimum flat fraction on the selected flatter side.
    minProfileAsymmetry: 0.25,   // Asymmetry needed for extra one-sided apron support.
    minValleyCrossingScore: 0.6, // Minimum approximate drainage-crossing score.
    arcWeight: 0.30,            // Contribution for an arcuate segment.
    kettleWeight: 0.25,         // Contribution for kettle context.
    apronFlatWeight: 0.10,      // Contribution for a flat apron proxy.
    apronAsymmetryWeight: 0.10, // Extra apron contribution for asymmetric profiles.
    valleyCrossingWeight: 0.15, // Contribution for crossing the local low axis.
    prominenceWeight: 0.10,    // Contribution for strong crest prominence only.
    deadStraightPenalty: 0.25, // Subtracted for fault/terrace-like straightness.
    likelyScore: 0.55,          // Inclusive likely score threshold, with gates below.
    possibleScore: 0.25,        // Inclusive possible score threshold.
    minLikelySignals: 2,        // Independent arc/kettle/apron/valley signals for likely.
    minPossibleSignals: 1,      // Independent signals for possible; relief alone fails.
    allowLikely: true           // Caller must set false for known coarse-filled DEMs.
  });

  var hasOwn = function (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  };
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
      if (!hasOwn(DEFAULT_CONFIG, key)) throw new TypeError("Unknown classifier config: " + key);
      config[key] = overrides[key];
    });
    Object.keys(config).forEach(function (key) {
      if (key === "allowLikely") {
        if (typeof config[key] !== "boolean") throw new TypeError("allowLikely must be boolean");
      } else if (!finite(config[key]) || config[key] < 0) {
        throw new RangeError(key + " must be a finite non-negative number");
      }
    });
    ["highArcScore", "deadStraightArcScore", "minStraightChordRatio", "minApronFlatFraction",
      "minProfileAsymmetry", "minValleyCrossingScore", "likelyScore", "possibleScore"
    ].forEach(function (key) {
      if (config[key] > 1) throw new RangeError(key + " must be at most 1");
    });
    if (config.minLengthM <= 0 || config.minProminenceM <= 0 || config.minElongation <= 0 ||
        config.minKettleDensityPerKm <= 0 || config.strongProminenceM <= config.minProminenceM ||
        config.highArcScore <= config.deadStraightArcScore || config.likelyScore <= config.possibleScore) {
      throw new RangeError("Physical minima must be positive; strong/arc/likely thresholds must exceed lower thresholds");
    }
    ["minLikelySignals", "minPossibleSignals"].forEach(function (key) {
      if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 4) {
        throw new RangeError(key + " must be an integer from 1 to 4");
      }
    });
    if (config.minLikelySignals < config.minPossibleSignals) {
      throw new RangeError("minLikelySignals must be at least minPossibleSignals");
    }
    return config;
  }

  function classify(segment, features, config) {
    segment = segment || {};
    var featuresNotEvaluated = features === null;
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
    function physicalGate(key, value, minimum, unit) {
      var valid = finite(value) && value >= 0;
      var rejected = !valid || value < minimum;
      var reason = !valid ? "invalid-" + key : "too-low-" + key;
      if (key === "length" && valid) reason = "too-short";
      if (key === "elongation" && valid) reason = "too-flat";
      if (rejected) hardRejects.push(reason);
      record(key, "Measured " + key + " " + measurement(value, unit) + "; required >= " +
        minimum + unit + ". " + (rejected ? "Hard reject: " + reason + "." : "Physical gate passed."),
        rejected ? -1 : 0);
    }

    // Missing/non-finite mandatory physical measurements fail closed. Optional
    // missing/out-of-range context is neutral, never renormalized into support.
    physicalGate("length", segment.lengthM, config.minLengthM, " m");
    physicalGate("elongation", segment.elongation, config.minElongation, "");
    record("geometry", "Area " + measurement(segment.areaM2, " m2") + "; mean width " +
      measurement(segment.meanWidthM, " m") + ". Area filtering belongs to candidate extraction; neither value adds score.", 0);
    if (segment.branched) {
      record("branching", "Shape is unreliable due to branching; verdict capped at possible.", -1);
    }
    if (featuresNotEvaluated) {
      record("features", "features not evaluated", 0);
      record("decision", "Geometry-only rejection; returned score 0. Hard rejects: " +
        (hardRejects.length ? hardRejects.join(", ") : "none") + ". Verdict: unsupported.", -1);
      return { verdict: "unsupported", score: 0, evidence: evidence, hardRejects: hardRejects };
    }
    physicalGate("prominence", features.prominenceM, config.minProminenceM, " m");

    var arcValid = inRange(segment.arcScore, 0, 1);
    var arc = arcValid && segment.arcScore >= config.highArcScore;
    // Skeleton coordinates are pixels, whereas lengthM includes end-width
    // correction. Recover pixel spacing from area/count, or the raw skeleton
    // length; do not mistake a zero arc score on a zigzag or loop for a line.
    var path = segment.skeleton, chordRatio = NaN, cellMetres = NaN;
    if (finite(segment.areaM2) && segment.areaM2 > 0 &&
        finite(segment.pixelCount) && segment.pixelCount > 0) {
      cellMetres = Math.sqrt(segment.areaM2 / segment.pixelCount);
    } else if (Array.isArray(path) && finite(segment.skeletonLengthM)) {
      var pathLength = 0;
      for (var p = 1; p < path.length; p++) {
        pathLength += Math.hypot(path[p][0] - path[p - 1][0], path[p][1] - path[p - 1][1]);
      }
      if (pathLength > 0) cellMetres = segment.skeletonLengthM / pathLength;
    }
    if (Array.isArray(path) && path.length >= 2 && finite(cellMetres) && cellMetres > 0 &&
        finite(segment.lengthM) && segment.lengthM > 0) {
      var first = path[0], last = path[path.length - 1];
      chordRatio = Math.hypot(last[0] - first[0], last[1] - first[1]) * cellMetres / segment.lengthM;
    }
    var loop = !!(segment.closedLoop || segment.simpleCycle);
    var straight = !loop && finite(segment.netBendRad) &&
      Math.abs(segment.netBendRad) < config.maxStraightBendRad &&
      finite(chordRatio) && chordRatio > config.minStraightChordRatio;
    contribute("arc", "Arc score " + measurement(segment.arcScore) + "; arcuate threshold >= " +
      config.highArcScore + (arcValid ? (arc ? ": arcuate support" : ": no arcuate support") : ": unavailable/out of [0,1]"),
      arc ? config.arcWeight : 0);
    contribute("dead-straight", "Absolute net bend " + measurement(Math.abs(segment.netBendRad), " rad") +
      "; endpoint chord / length " + measurement(chordRatio) + "; straight requires bend < " +
      config.maxStraightBendRad + " rad and chord ratio > " + config.minStraightChordRatio +
      (loop ? "; closed loop/simple cycle: straightness penalty skipped" :
        straight ? ": fault/terrace-like shape; blocks likely" : ": no straightness penalty"),
      straight ? -config.deadStraightPenalty : 0);

    var kettles = (finite(features.kettleCount) && features.kettleCount >= config.minKettleCount) ||
      (finite(features.kettleDensityPerKm) && features.kettleDensityPerKm >= config.minKettleDensityPerKm) ||
      (finite(features.kettleDensityPerKm2) && features.kettleDensityPerKm2 >= config.minKettleDensityPerKm2);
    contribute("kettles", "Kettle density " + measurement(features.kettleDensityPerKm, " per km") +
      "; areal density " + measurement(features.kettleDensityPerKm2, " per km2") +
      "; kettle count " + measurement(features.kettleCount) + "; support requires count >= " +
      config.minKettleCount + " OR density >= " + config.minKettleDensityPerKm +
      " per km OR >= " + config.minKettleDensityPerKm2 + " per km2",
      kettles ? config.kettleWeight : 0);

    // The interface gives only the flatter-side fraction, not both fractions.
    // Use it as an apron proxy, and reward profile asymmetry separately as an
    // approximation to one-sidedness. apronSide is a label, not a slope test;
    // no sign encoding is assumed. This cannot establish depositional origin.
    var apronValid = inRange(features.apronFlatFraction, 0, 1);
    var apron = apronValid && features.apronFlatFraction >= config.minApronFlatFraction;
    var asymmetric = inRange(features.profileAsymmetry, 0, 1) &&
      features.profileAsymmetry >= config.minProfileAsymmetry;
    var side = features.apronSide == null ? "unspecified" : String(features.apronSide);
    contribute("flat-apron", "Flatter-side apron fraction " + measurement(features.apronFlatFraction) +
      "; selected side " + side + "; flat threshold >= " + config.minApronFlatFraction +
      (apronValid ? "; proxy only: opposite-side flat fraction is not supplied" : "; fraction unavailable/out of [0,1]"),
      apron ? config.apronFlatWeight : 0);
    contribute("one-sided-apron", "Profile asymmetry " + measurement(features.profileAsymmetry) +
      "; threshold >= " + config.minProfileAsymmetry + "; flat apron proxy " + (apron ? "present" : "absent") +
      "; asymmetric profile plus flat apron approximates one-sidedness",
      apron && asymmetric ? config.apronAsymmetryWeight : 0);

    var crossingValid = inRange(features.valleyCrossingScore, 0, 1);
    var crossing = crossingValid && features.valleyCrossingScore >= config.minValleyCrossingScore;
    contribute("valley-crossing", "Valley crossing score " + measurement(features.valleyCrossingScore) +
      "; threshold >= " + config.minValleyCrossingScore + "; approximate local low-axis crossing" +
      (crossingValid ? "" : "; unavailable/out of [0,1]"), crossing ? config.valleyCrossingWeight : 0);

    var prominenceValid = finite(features.prominenceM) && features.prominenceM >= 0;
    var strong = prominenceValid && features.prominenceM >= config.strongProminenceM;
    contribute("prominence-strength", "Crest prominence " + measurement(features.prominenceM, " m") +
      "; strong threshold >= " + config.strongProminenceM + " m" +
      (strong ? ": strong" : ": no strength support; prominence above the physical gate is neutral"),
      strong ? config.prominenceWeight : 0);
    // Do not reward slope, relief, or roughness: steep unglaciated hills, loess,
    // dunes and fault scarps saturated those features in the old pixel screen.
    record("steepness-not-diagnostic", "Mean slope " + measurement(features.meanSlopeDeg, " degrees") +
      "; relief " + measurement(features.reliefM, " m") + "; roughness " + measurement(features.roughness) +
      ". These observations add no score; steep ground alone does not identify a moraine.", 0);

    var signals = [arc, kettles, apron, crossing].filter(function (value) { return value; }).length;
    // An arc is shape evidence; at least one non-arc context signal is also
    // required for likely. Flatness and profile asymmetry count as ONE signal.
    var context = kettles || apron || crossing;
    var likelyGates = config.allowLikely && strong && arcValid && !straight && !segment.branched &&
      signals >= config.minLikelySignals && context;
    record("likely-gates", "Likely requires prominence >= " + config.strongProminenceM + " m (measured " +
      measurement(features.prominenceM, " m") + "); valid non-straight arc (measured " + measurement(segment.arcScore) +
      ", straight=" + straight + "); unbranched shape (branched=" + !!segment.branched +
      "); >= " + config.minLikelySignals +
      " independent signals (observed " + signals + "); kettle/apron/valley context (" + (context ? "present" : "absent") +
      "); allowLikely=" + config.allowLikely + ". Gates " + (likelyGates ? "passed." : "failed."), likelyGates ? 1 : -1);
    // The pinned feature shape has no lidar/DEM quality field. Integration must
    // set allowLikely=false when quality is known to be coarse-filled; unknown
    // quality is not asserted to be lidar here and remains the caller's concern.
    record("data-quality", "allowLikely=" + config.allowLikely +
      (config.allowLikely ? "; no DEM quality supplied by this interface; caller must gate known coarse-filled data."
        : "; caller disabled likely (for example, known coarse-filled DEM)."), config.allowLikely ? 0 : -1);
    // TODO: set-level regular periodic spacing (dune confuser) is not supplied.
    // No contour direction is supplied either: do not infer contour-parallel
    // terraces from orientationRad or low valley-crossing score alone.
    record("unassessed-confusers", "Contour-parallel terraces and periodic ridge spacing are unassessed: contour direction and set-level spacing are not in the input interface.", 0);

    var score = Math.max(0, Math.min(1, rawScore));
    var verdict = "unsupported", decision;
    if (hardRejects.length) {
      score = 0;
      decision = "Hard rejects override the score: " + hardRejects.join(", ") + "; returned score 0";
    } else if (score + 1e-9 >= config.likelyScore && likelyGates) {
      verdict = "likely";
      decision = "Score >= likely threshold " + config.likelyScore + " and all likely gates passed";
    } else if (score + 1e-9 >= config.possibleScore && signals >= config.minPossibleSignals) {
      verdict = "possible";
      decision = "Likely requires score >= " + config.likelyScore + " and all likely gates; possible requires score >= " +
        config.possibleScore + " and >= " + config.minPossibleSignals + " signals (observed " + signals + ")";
    } else {
      decision = "Possible requires score >= " + config.possibleScore + " and >= " + config.minPossibleSignals +
        " signals (observed " + signals + "); requirements failed";
    }
    record("decision", "Raw contribution sum " + rawScore + "; clamp to [0,1]; returned score " + score +
      ". " + decision + ". Verdict: " + verdict + ". Morphology screening only, not proof of glaciation.",
      verdict === "likely" ? 1 : verdict === "unsupported" ? -1 : 0);
    return { verdict: verdict, score: score, evidence: evidence, hardRejects: hardRejects };
  }

  function classifySegment(segment, features, config) {
    return classify(segment, features, resolveConfig(config));
  }

  // The design's segmentsWithFeatures list is interpreted as {segment, features}
  // pairs; return classification results in the same order, without mutation.
  function classifySegments(segmentsWithFeatures, config) {
    if (!Array.isArray(segmentsWithFeatures)) throw new TypeError("segmentsWithFeatures must be an array");
    var resolved = resolveConfig(config);
    return segmentsWithFeatures.map(function (entry) {
      if (!entry || typeof entry !== "object" || !entry.segment ||
          (!entry.features && entry.features !== null)) {
        throw new TypeError("Each entry must contain {segment, features}");
      }
      return classify(entry.segment, entry.features, resolved);
    });
  }

  return Object.freeze({
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    classifySegment: classifySegment,
    classifySegments: classifySegments
  });
}));
