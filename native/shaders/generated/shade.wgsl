struct CspCtx {
    p: vec2<i32>,
    height: f32,
    base: f32,
    dx: f32,
    dy: f32,
    sdx: f32,
    sdy: f32,
    res: f32,
    slope: f32,
    aspect: f32,
}

struct CskUniforms {
    u_style: i32,
    csk_pad_u_style_1_: f32,
    csk_pad_u_style_2_: f32,
    csk_pad_u_style_3_: f32,
    u_terrainOpacity: f32,
    csk_pad_u_terrainOpacity_1_: f32,
    csk_pad_u_terrainOpacity_2_: f32,
    csk_pad_u_terrainOpacity_3_: f32,
    u_sunAzimuth: f32,
    csk_pad_u_sunAzimuth_1_: f32,
    csk_pad_u_sunAzimuth_2_: f32,
    csk_pad_u_sunAzimuth_3_: f32,
    u_sunAltitude: f32,
    csk_pad_u_sunAltitude_1_: f32,
    csk_pad_u_sunAltitude_2_: f32,
    csk_pad_u_sunAltitude_3_: f32,
    u_ambient: f32,
    csk_pad_u_ambient_1_: f32,
    csk_pad_u_ambient_2_: f32,
    csk_pad_u_ambient_3_: f32,
    u_lookSaturation: f32,
    csk_pad_u_lookSaturation_1_: f32,
    csk_pad_u_lookSaturation_2_: f32,
    csk_pad_u_lookSaturation_3_: f32,
    u_lookContrast: f32,
    csk_pad_u_lookContrast_1_: f32,
    csk_pad_u_lookContrast_2_: f32,
    csk_pad_u_lookContrast_3_: f32,
    u_lookBrightness: f32,
    csk_pad_u_lookBrightness_1_: f32,
    csk_pad_u_lookBrightness_2_: f32,
    csk_pad_u_lookBrightness_3_: f32,
    u_spectrumOn: f32,
    csk_pad_u_spectrumOn_1_: f32,
    csk_pad_u_spectrumOn_2_: f32,
    csk_pad_u_spectrumOn_3_: f32,
    u_spectrumLevel: f32,
    csk_pad_u_spectrumLevel_1_: f32,
    csk_pad_u_spectrumLevel_2_: f32,
    csk_pad_u_spectrumLevel_3_: f32,
    u_spectrumSpan: f32,
    csk_pad_u_spectrumSpan_1_: f32,
    csk_pad_u_spectrumSpan_2_: f32,
    csk_pad_u_spectrumSpan_3_: f32,
    u_spectrumAlpha: f32,
    csk_pad_u_spectrumAlpha_1_: f32,
    csk_pad_u_spectrumAlpha_2_: f32,
    csk_pad_u_spectrumAlpha_3_: f32,
    u_spectrumLow: vec3<f32>,
    csk_pad_u_spectrumLow_3_: f32,
    u_spectrumMid: vec3<f32>,
    csk_pad_u_spectrumMid_3_: f32,
    u_spectrumHigh: vec3<f32>,
    csk_pad_u_spectrumHigh_3_: f32,
    u_belowOn: f32,
    csk_pad_u_belowOn_1_: f32,
    csk_pad_u_belowOn_2_: f32,
    csk_pad_u_belowOn_3_: f32,
    u_belowLevel: f32,
    csk_pad_u_belowLevel_1_: f32,
    csk_pad_u_belowLevel_2_: f32,
    csk_pad_u_belowLevel_3_: f32,
    u_belowColor: vec3<f32>,
    csk_pad_u_belowColor_3_: f32,
    u_aboveOn: f32,
    csk_pad_u_aboveOn_1_: f32,
    csk_pad_u_aboveOn_2_: f32,
    csk_pad_u_aboveOn_3_: f32,
    u_aboveLevel: f32,
    csk_pad_u_aboveLevel_1_: f32,
    csk_pad_u_aboveLevel_2_: f32,
    csk_pad_u_aboveLevel_3_: f32,
    u_aboveColor: vec3<f32>,
    csk_pad_u_aboveColor_3_: f32,
    u_bandAlpha: f32,
    csk_pad_u_bandAlpha_1_: f32,
    csk_pad_u_bandAlpha_2_: f32,
    csk_pad_u_bandAlpha_3_: f32,
    u_bandFeather: f32,
    csk_pad_u_bandFeather_1_: f32,
    csk_pad_u_bandFeather_2_: f32,
    csk_pad_u_bandFeather_3_: f32,
    u_outlineOn: f32,
    csk_pad_u_outlineOn_1_: f32,
    csk_pad_u_outlineOn_2_: f32,
    csk_pad_u_outlineOn_3_: f32,
    u_outlineWidth: f32,
    csk_pad_u_outlineWidth_1_: f32,
    csk_pad_u_outlineWidth_2_: f32,
    csk_pad_u_outlineWidth_3_: f32,
    u_spectrumOpacity: f32,
    csk_pad_u_spectrumOpacity_1_: f32,
    csk_pad_u_spectrumOpacity_2_: f32,
    csk_pad_u_spectrumOpacity_3_: f32,
    u_centerMerc: vec2<f32>,
    csk_pad_u_centerMerc_2_: f32,
    csk_pad_u_centerMerc_3_: f32,
    u_zoom: f32,
    csk_pad_u_zoom_1_: f32,
    csk_pad_u_zoom_2_: f32,
    csk_pad_u_zoom_3_: f32,
    u_bearingRad: f32,
    csk_pad_u_bearingRad_1_: f32,
    csk_pad_u_bearingRad_2_: f32,
    csk_pad_u_bearingRad_3_: f32,
    u_cssSize: vec2<f32>,
    csk_pad_u_cssSize_2_: f32,
    csk_pad_u_cssSize_3_: f32,
    u_dpr: f32,
    csk_pad_u_dpr_1_: f32,
    csk_pad_u_dpr_2_: f32,
    csk_pad_u_dpr_3_: f32,
    u_groundResOverride: f32,
    csk_pad_u_groundResOverride_1_: f32,
    csk_pad_u_groundResOverride_2_: f32,
    csk_pad_u_groundResOverride_3_: f32,
    u_stackOn: f32,
    csk_pad_u_stackOn_1_: f32,
    csk_pad_u_stackOn_2_: f32,
    csk_pad_u_stackOn_3_: f32,
    u_stackGradient: f32,
    csk_pad_u_stackGradient_1_: f32,
    csk_pad_u_stackGradient_2_: f32,
    csk_pad_u_stackGradient_3_: f32,
    u_layerCount: f32,
    csk_pad_u_layerCount_1_: f32,
    csk_pad_u_layerCount_2_: f32,
    csk_pad_u_layerCount_3_: f32,
    u_layerA: array<vec4<f32>, 4>,
    u_layerB: array<vec4<f32>, 4>,
    u_layerC: array<vec4<f32>, 4>,
    u_layerD: array<vec4<f32>, 4>,
    u_layerPos: array<vec4<f32>, 12>,
    u_layerColors: array<vec4<f32>, 40>,
    u_detail: f32,
    csk_pad_u_detail_1_: f32,
    csk_pad_u_detail_2_: f32,
    csk_pad_u_detail_3_: f32,
    u_reliefExag: f32,
    csk_pad_u_reliefExag_1_: f32,
    csk_pad_u_reliefExag_2_: f32,
    csk_pad_u_reliefExag_3_: f32,
    u_remFlatBase: f32,
    csk_pad_u_remFlatBase_1_: f32,
    csk_pad_u_remFlatBase_2_: f32,
    csk_pad_u_remFlatBase_3_: f32,
    u_remLandBase: f32,
    csk_pad_u_remLandBase_1_: f32,
    csk_pad_u_remLandBase_2_: f32,
    csk_pad_u_remLandBase_3_: f32,
}

@group(0) @binding(1) 
var csk_heights: texture_2d<f32>;
@group(0) @binding(2) 
var csk_ranks: texture_2d<u32>;
@group(0) @binding(4) 
var csk_blur: texture_2d<f32>;
@group(0) @binding(5) 
var csk_base: texture_2d<f32>;
@group(0) @binding(6) 
var csk_land: texture_2d<f32>;
@group(0) @binding(0) 
var<uniform> unnamed: CskUniforms;
@group(0) @binding(3) 
var u_waterMask: texture_2d<u32>;
var<private> v_screenUv_1: vec2<f32>;
var<private> fragColor: vec4<f32>;

fn cspApplyAppearance_u0028_vf3_u003b(straight: ptr<function, vec3<f32>>) -> vec3<f32> {
    var s: f32;
    var c: vec3<f32>;

    let _e264: f32 = unnamed.u_lookSaturation;
    s = _e264;
    let _e265: f32 = s;
    let _e269: f32 = (*straight)[0u];
    let _e271: f32 = s;
    let _e275: f32 = (*straight)[1u];
    let _e278: f32 = s;
    let _e282: f32 = (*straight)[2u];
    let _e285: f32 = s;
    let _e289: f32 = (*straight)[0u];
    let _e291: f32 = s;
    let _e295: f32 = (*straight)[1u];
    let _e298: f32 = s;
    let _e302: f32 = (*straight)[2u];
    let _e305: f32 = s;
    let _e309: f32 = (*straight)[0u];
    let _e311: f32 = s;
    let _e315: f32 = (*straight)[1u];
    let _e318: f32 = s;
    let _e322: f32 = (*straight)[2u];
    c = vec3<f32>(((((0.213f + (0.787f * _e265)) * _e269) + ((0.715f - (0.715f * _e271)) * _e275)) + ((0.072f - (0.072f * _e278)) * _e282)), ((((0.213f - (0.213f * _e285)) * _e289) + ((0.715f + (0.285f * _e291)) * _e295)) + ((0.072f - (0.072f * _e298)) * _e302)), ((((0.213f - (0.213f * _e305)) * _e309) + ((0.715f - (0.715f * _e311)) * _e315)) + ((0.072f + (0.928f * _e318)) * _e322)));
    let _e326: vec3<f32> = c;
    c = clamp(_e326, vec3(0f), vec3(1f));
    let _e330: vec3<f32> = c;
    let _e332: f32 = unnamed.u_lookContrast;
    let _e335: f32 = unnamed.u_lookContrast;
    c = clamp(((_e330 * _e332) + vec3(((1f - _e335) * 0.5f))), vec3(0f), vec3(1f));
    let _e343: vec3<f32> = c;
    let _e345: f32 = unnamed.u_lookBrightness;
    c = clamp((_e343 * _e345), vec3(0f), vec3(1f));
    let _e350: vec3<f32> = c;
    return _e350;
}

fn cspTintColour_u0028_f1_u003b(value: ptr<function, f32>) -> vec3<f32> {
    var c0_: vec3<f32>;
    var c1_: vec3<f32>;
    var c2_: vec3<f32>;
    var c3_: vec3<f32>;
    var c4_: vec3<f32>;
    var c5_: vec3<f32>;
    var c6_: vec3<f32>;
    var c7_: vec3<f32>;

    c0_ = vec3<f32>(0.08627451f, 0.18039216f, 0.28235295f);
    c1_ = vec3<f32>(0.15686275f, 0.27450982f, 0.37254903f);
    c2_ = vec3<f32>(0.27450982f, 0.43137255f, 0.27450982f);
    c3_ = vec3<f32>(0.5019608f, 0.54901963f, 0.36078432f);
    c4_ = vec3<f32>(0.627451f, 0.54901963f, 0.42352942f);
    c5_ = vec3<f32>(0.74509805f, 0.7058824f, 0.6666667f);
    c6_ = vec3<f32>(0.9607843f, 0.9647059f, 0.98039216f);
    c7_ = vec3<f32>(1f, 1f, 1f);
    let _e269: f32 = (*value);
    if (_e269 <= -500f) {
        let _e271: vec3<f32> = c0_;
        return _e271;
    }
    let _e272: f32 = (*value);
    if (_e272 <= 0f) {
        let _e274: vec3<f32> = c0_;
        let _e275: vec3<f32> = c1_;
        let _e276: f32 = (*value);
        return mix(_e274, _e275, vec3(((_e276 + 500f) / 500f)));
    }
    let _e281: f32 = (*value);
    if (_e281 <= 300f) {
        let _e283: vec3<f32> = c1_;
        let _e284: vec3<f32> = c2_;
        let _e285: f32 = (*value);
        return mix(_e283, _e284, vec3((_e285 / 300f)));
    }
    let _e289: f32 = (*value);
    if (_e289 <= 900f) {
        let _e291: vec3<f32> = c2_;
        let _e292: vec3<f32> = c3_;
        let _e293: f32 = (*value);
        return mix(_e291, _e292, vec3(((_e293 - 300f) / 600f)));
    }
    let _e298: f32 = (*value);
    if (_e298 <= 1600f) {
        let _e300: vec3<f32> = c3_;
        let _e301: vec3<f32> = c4_;
        let _e302: f32 = (*value);
        return mix(_e300, _e301, vec3(((_e302 - 900f) / 700f)));
    }
    let _e307: f32 = (*value);
    if (_e307 <= 2400f) {
        let _e309: vec3<f32> = c4_;
        let _e310: vec3<f32> = c5_;
        let _e311: f32 = (*value);
        return mix(_e309, _e310, vec3(((_e311 - 1600f) / 800f)));
    }
    let _e316: f32 = (*value);
    if (_e316 <= 3200f) {
        let _e318: vec3<f32> = c5_;
        let _e319: vec3<f32> = c6_;
        let _e320: f32 = (*value);
        return mix(_e318, _e319, vec3(((_e320 - 2400f) / 800f)));
    }
    let _e325: f32 = (*value);
    if (_e325 <= 6000f) {
        let _e327: vec3<f32> = c6_;
        let _e328: vec3<f32> = c7_;
        let _e329: f32 = (*value);
        return mix(_e327, _e328, vec3(((_e329 - 3200f) / 2800f)));
    }
    let _e334: vec3<f32> = c7_;
    return _e334;
}

fn cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(dx: ptr<function, f32>, dy: ptr<function, f32>, azimuth: ptr<function, f32>) -> f32 {
    var east: f32;
    var north: f32;
    var altitude: f32;
    var az: f32;

    let _e267: f32 = (*dx);
    east = _e267;
    let _e268: f32 = (*dy);
    north = -(_e268);
    let _e271: f32 = unnamed.u_sunAltitude;
    altitude = radians(_e271);
    let _e273: f32 = (*azimuth);
    az = radians(_e273);
    let _e275: f32 = east;
    let _e277: f32 = altitude;
    let _e280: f32 = az;
    let _e283: f32 = north;
    let _e284: f32 = altitude;
    let _e287: f32 = az;
    let _e291: f32 = altitude;
    let _e294: f32 = east;
    let _e295: f32 = east;
    let _e297: f32 = north;
    let _e298: f32 = north;
    return clamp((((((-(_e275) * cos(_e277)) * sin(_e280)) - ((_e283 * cos(_e284)) * cos(_e287))) + sin(_e291)) / sqrt((((_e294 * _e295) + (_e297 * _e298)) + 1f))), 0f, 1f);
}

fn cspAspectColour_u0028_f1_u003b(degreesValue: ptr<function, f32>) -> vec3<f32> {
    var sector: f32;
    var t: f32;
    var a: vec3<f32>;
    var b: vec3<f32>;

    let _e265: f32 = (*degreesValue);
    sector = floor((_e265 / 45f));
    let _e268: f32 = (*degreesValue);
    t = fract((_e268 / 45f));
    let _e271: f32 = sector;
    if (_e271 < 1f) {
        a = vec3<f32>(77f, 120f, 200f);
        b = vec3<f32>(59f, 165f, 176f);
    } else {
        let _e273: f32 = sector;
        if (_e273 < 2f) {
            a = vec3<f32>(59f, 165f, 176f);
            b = vec3<f32>(87f, 167f, 101f);
        } else {
            let _e275: f32 = sector;
            if (_e275 < 3f) {
                a = vec3<f32>(87f, 167f, 101f);
                b = vec3<f32>(201f, 173f, 79f);
            } else {
                let _e277: f32 = sector;
                if (_e277 < 4f) {
                    a = vec3<f32>(201f, 173f, 79f);
                    b = vec3<f32>(217f, 107f, 82f);
                } else {
                    let _e279: f32 = sector;
                    if (_e279 < 5f) {
                        a = vec3<f32>(217f, 107f, 82f);
                        b = vec3<f32>(196f, 91f, 130f);
                    } else {
                        let _e281: f32 = sector;
                        if (_e281 < 6f) {
                            a = vec3<f32>(196f, 91f, 130f);
                            b = vec3<f32>(141f, 101f, 187f);
                        } else {
                            let _e283: f32 = sector;
                            if (_e283 < 7f) {
                                a = vec3<f32>(141f, 101f, 187f);
                                b = vec3<f32>(94f, 119f, 197f);
                            } else {
                                a = vec3<f32>(94f, 119f, 197f);
                                b = vec3<f32>(77f, 120f, 200f);
                            }
                        }
                    }
                }
            }
        }
    }
    let _e285: vec3<f32> = a;
    let _e286: vec3<f32> = b;
    let _e287: f32 = t;
    return (mix(_e285, _e286, vec3(_e287)) / vec3(255f));
}

fn cspAspectOf_u0028_f1_u003b_f1_u003b(dx_1: ptr<function, f32>, dy_1: ptr<function, f32>) -> f32 {
    let _e262: f32 = (*dx_1);
    let _e264: f32 = (*dy_1);
    let _e267: f32 = (degrees(atan2(-(_e262), _e264)) + 360f);
    return (_e267 - (floor((_e267 / 360f)) * 360f));
}

fn cspRamp_u0028_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b(value_1: ptr<function, f32>, c0_1: ptr<function, vec3<f32>>, v1_: ptr<function, f32>, c1_1: ptr<function, vec3<f32>>, v2_: ptr<function, f32>, c2_1: ptr<function, vec3<f32>>, v3_: ptr<function, f32>, c3_1: ptr<function, vec3<f32>>, v4_: ptr<function, f32>, c4_1: ptr<function, vec3<f32>>, v5_: ptr<function, f32>, c5_1: ptr<function, vec3<f32>>, v6_: ptr<function, f32>, c6_1: ptr<function, vec3<f32>>) -> vec3<f32> {
    let _e274: f32 = (*value_1);
    let _e275: f32 = (*v1_);
    if (_e274 <= _e275) {
        let _e277: vec3<f32> = (*c0_1);
        let _e278: vec3<f32> = (*c1_1);
        let _e279: f32 = (*value_1);
        let _e280: f32 = (*v1_);
        return mix(_e277, _e278, vec3(clamp((_e279 / max(_e280, 0.0001f)), 0f, 1f)));
    }
    let _e286: f32 = (*value_1);
    let _e287: f32 = (*v2_);
    if (_e286 <= _e287) {
        let _e289: vec3<f32> = (*c1_1);
        let _e290: vec3<f32> = (*c2_1);
        let _e291: f32 = (*value_1);
        let _e292: f32 = (*v1_);
        let _e294: f32 = (*v2_);
        let _e295: f32 = (*v1_);
        return mix(_e289, _e290, vec3(((_e291 - _e292) / (_e294 - _e295))));
    }
    let _e300: f32 = (*value_1);
    let _e301: f32 = (*v3_);
    if (_e300 <= _e301) {
        let _e303: vec3<f32> = (*c2_1);
        let _e304: vec3<f32> = (*c3_1);
        let _e305: f32 = (*value_1);
        let _e306: f32 = (*v2_);
        let _e308: f32 = (*v3_);
        let _e309: f32 = (*v2_);
        return mix(_e303, _e304, vec3(((_e305 - _e306) / (_e308 - _e309))));
    }
    let _e314: f32 = (*value_1);
    let _e315: f32 = (*v4_);
    if (_e314 <= _e315) {
        let _e317: vec3<f32> = (*c3_1);
        let _e318: vec3<f32> = (*c4_1);
        let _e319: f32 = (*value_1);
        let _e320: f32 = (*v3_);
        let _e322: f32 = (*v4_);
        let _e323: f32 = (*v3_);
        return mix(_e317, _e318, vec3(((_e319 - _e320) / (_e322 - _e323))));
    }
    let _e328: f32 = (*value_1);
    let _e329: f32 = (*v5_);
    if (_e328 <= _e329) {
        let _e331: vec3<f32> = (*c4_1);
        let _e332: vec3<f32> = (*c5_1);
        let _e333: f32 = (*value_1);
        let _e334: f32 = (*v4_);
        let _e336: f32 = (*v5_);
        let _e337: f32 = (*v4_);
        return mix(_e331, _e332, vec3(((_e333 - _e334) / (_e336 - _e337))));
    }
    let _e342: f32 = (*value_1);
    let _e343: f32 = (*v6_);
    if (_e342 <= _e343) {
        let _e345: vec3<f32> = (*c5_1);
        let _e346: vec3<f32> = (*c6_1);
        let _e347: f32 = (*value_1);
        let _e348: f32 = (*v5_);
        let _e350: f32 = (*v6_);
        let _e351: f32 = (*v5_);
        return mix(_e345, _e346, vec3(((_e347 - _e348) / (_e350 - _e351))));
    }
    let _e356: vec3<f32> = (*c6_1);
    return _e356;
}

fn cspSlopeColour_u0028_f1_u003b(degreesValue_1: ptr<function, f32>) -> vec3<f32> {
    var param: f32;
    var param_1: vec3<f32>;
    var param_2: f32;
    var param_3: vec3<f32>;
    var param_4: f32;
    var param_5: vec3<f32>;
    var param_6: f32;
    var param_7: vec3<f32>;
    var param_8: f32;
    var param_9: vec3<f32>;
    var param_10: f32;
    var param_11: vec3<f32>;
    var param_12: f32;
    var param_13: vec3<f32>;

    let _e275: f32 = (*degreesValue_1);
    param = _e275;
    param_1 = vec3<f32>(0.9490196f, 0.95686275f, 0.93333334f);
    param_2 = 5f;
    param_3 = vec3<f32>(0.69411767f, 0.8235294f, 0.54509807f);
    param_4 = 15f;
    param_5 = vec3<f32>(0.9647059f, 0.85490197f, 0.43529412f);
    param_6 = 30f;
    param_7 = vec3<f32>(0.9411765f, 0.5882353f, 0.28627452f);
    param_8 = 45f;
    param_9 = vec3<f32>(0.8352941f, 0.27450982f, 0.3137255f);
    param_10 = 60f;
    param_11 = vec3<f32>(0.4627451f, 0.17254902f, 0.4117647f);
    param_12 = 90f;
    param_13 = vec3<f32>(0.19607843f, 0.09803922f, 0.28235295f);
    let _e276: vec3<f32> = cspRamp_u0028_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b((&param), (&param_1), (&param_2), (&param_3), (&param_4), (&param_5), (&param_6), (&param_7), (&param_8), (&param_9), (&param_10), (&param_11), (&param_12), (&param_13));
    return _e276;
}

fn cspLum_u0028_vf3_u003b(c_1: ptr<function, vec3<f32>>) -> f32 {
    let _e261: vec3<f32> = (*c_1);
    return dot(_e261, vec3<f32>(0.3f, 0.59f, 0.11f));
}

fn cspClipColour_u0028_vf3_u003b(c_2: ptr<function, vec3<f32>>) -> vec3<f32> {
    var l: f32;
    var param_14: vec3<f32>;
    var n: f32;
    var x: f32;

    let _e265: vec3<f32> = (*c_2);
    param_14 = _e265;
    let _e266: f32 = cspLum_u0028_vf3_u003b((&param_14));
    l = _e266;
    let _e268: f32 = (*c_2)[0u];
    let _e270: f32 = (*c_2)[1u];
    let _e273: f32 = (*c_2)[2u];
    n = min(min(_e268, _e270), _e273);
    let _e276: f32 = (*c_2)[0u];
    let _e278: f32 = (*c_2)[1u];
    let _e281: f32 = (*c_2)[2u];
    x = max(max(_e276, _e278), _e281);
    let _e283: f32 = n;
    if (_e283 < 0f) {
        let _e285: f32 = l;
        let _e286: vec3<f32> = (*c_2);
        let _e287: f32 = l;
        let _e290: f32 = l;
        let _e292: f32 = l;
        let _e293: f32 = n;
        (*c_2) = (vec3(_e285) + (((_e286 - vec3(_e287)) * _e290) / vec3(max((_e292 - _e293), 0.000001f))));
    }
    let _e300: f32 = x;
    if (_e300 > 1f) {
        let _e302: f32 = l;
        let _e303: vec3<f32> = (*c_2);
        let _e304: f32 = l;
        let _e307: f32 = l;
        let _e310: f32 = x;
        let _e311: f32 = l;
        (*c_2) = (vec3(_e302) + (((_e303 - vec3(_e304)) * (1f - _e307)) / vec3(max((_e310 - _e311), 0.000001f))));
    }
    let _e318: vec3<f32> = (*c_2);
    return _e318;
}

fn cspSetLum_u0028_vf3_u003b_f1_u003b(c_3: ptr<function, vec3<f32>>, l_1: ptr<function, f32>) -> vec3<f32> {
    var param_15: vec3<f32>;
    var param_16: vec3<f32>;

    let _e264: vec3<f32> = (*c_3);
    let _e265: f32 = (*l_1);
    let _e266: vec3<f32> = (*c_3);
    param_15 = _e266;
    let _e267: f32 = cspLum_u0028_vf3_u003b((&param_15));
    param_16 = (_e264 + vec3((_e265 - _e267)));
    let _e271: vec3<f32> = cspClipColour_u0028_vf3_u003b((&param_16));
    return _e271;
}

fn cspSoftLight_u0028_vf3_u003b_vf3_u003b(b_1: ptr<function, vec3<f32>>, s_1: ptr<function, vec3<f32>>) -> vec3<f32> {
    var d: vec3<f32>;

    let _e263: vec3<f32> = (*b_1);
    let _e267: vec3<f32> = (*b_1);
    let _e271: vec3<f32> = (*b_1);
    let _e273: vec3<f32> = (*b_1);
    let _e275: vec3<f32> = (*b_1);
    d = mix((((((_e263 * 16f) - vec3(12f)) * _e267) + vec3(4f)) * _e271), sqrt(_e273), step(vec3(0.25f), _e275));
    let _e279: vec3<f32> = (*b_1);
    let _e280: vec3<f32> = (*s_1);
    let _e284: vec3<f32> = (*b_1);
    let _e286: vec3<f32> = (*b_1);
    let _e291: vec3<f32> = (*b_1);
    let _e292: vec3<f32> = (*s_1);
    let _e296: vec3<f32> = d;
    let _e297: vec3<f32> = (*b_1);
    let _e301: vec3<f32> = (*s_1);
    return mix((_e279 - (((vec3(1f) - (_e280 * 2f)) * _e284) * (vec3(1f) - _e286))), (_e291 + (((_e292 * 2f) - vec3(1f)) * (_e296 - _e297))), step(vec3(0.5f), _e301));
}

fn cspHardLight_u0028_vf3_u003b_vf3_u003b(b_2: ptr<function, vec3<f32>>, s_2: ptr<function, vec3<f32>>) -> vec3<f32> {
    let _e262: vec3<f32> = (*b_2);
    let _e264: vec3<f32> = (*s_2);
    let _e266: vec3<f32> = (*b_2);
    let _e269: vec3<f32> = (*s_2);
    let _e278: vec3<f32> = (*s_2);
    return mix(((_e262 * 2f) * _e264), (vec3(1f) - ((vec3(1f) - _e266) * (vec3(1f) - ((_e269 * 2f) - vec3(1f))))), step(vec3(0.5f), _e278));
}

fn cspBlendMode_u0028_i1_u003b_vf3_u003b_vf3_u003b(mode: ptr<function, i32>, b_3: ptr<function, vec3<f32>>, s_3: ptr<function, vec3<f32>>) -> vec3<f32> {
    var param_17: vec3<f32>;
    var param_18: vec3<f32>;
    var param_19: vec3<f32>;
    var param_20: vec3<f32>;
    var param_21: vec3<f32>;
    var param_22: vec3<f32>;
    var param_23: vec3<f32>;
    var param_24: vec3<f32>;
    var param_25: f32;
    var param_26: vec3<f32>;
    var param_27: vec3<f32>;
    var param_28: f32;

    let _e275: i32 = (*mode);
    if (_e275 == 1i) {
        let _e277: vec3<f32> = (*b_3);
        let _e278: vec3<f32> = (*s_3);
        return (_e277 * _e278);
    }
    let _e280: i32 = (*mode);
    if (_e280 == 2i) {
        let _e282: vec3<f32> = (*b_3);
        let _e283: vec3<f32> = (*s_3);
        let _e285: vec3<f32> = (*b_3);
        let _e286: vec3<f32> = (*s_3);
        return ((_e282 + _e283) - (_e285 * _e286));
    }
    let _e289: i32 = (*mode);
    if (_e289 == 3i) {
        let _e291: vec3<f32> = (*s_3);
        param_17 = _e291;
        let _e292: vec3<f32> = (*b_3);
        param_18 = _e292;
        let _e293: vec3<f32> = cspHardLight_u0028_vf3_u003b_vf3_u003b((&param_17), (&param_18));
        return _e293;
    }
    let _e294: i32 = (*mode);
    if (_e294 == 4i) {
        let _e296: vec3<f32> = (*b_3);
        param_19 = _e296;
        let _e297: vec3<f32> = (*s_3);
        param_20 = _e297;
        let _e298: vec3<f32> = cspSoftLight_u0028_vf3_u003b_vf3_u003b((&param_19), (&param_20));
        return _e298;
    }
    let _e299: i32 = (*mode);
    if (_e299 == 5i) {
        let _e301: vec3<f32> = (*b_3);
        param_21 = _e301;
        let _e302: vec3<f32> = (*s_3);
        param_22 = _e302;
        let _e303: vec3<f32> = cspHardLight_u0028_vf3_u003b_vf3_u003b((&param_21), (&param_22));
        return _e303;
    }
    let _e304: i32 = (*mode);
    if (_e304 == 6i) {
        let _e306: vec3<f32> = (*b_3);
        let _e307: vec3<f32> = (*s_3);
        return min(_e306, _e307);
    }
    let _e309: i32 = (*mode);
    if (_e309 == 7i) {
        let _e311: vec3<f32> = (*b_3);
        let _e312: vec3<f32> = (*s_3);
        return max(_e311, _e312);
    }
    let _e314: i32 = (*mode);
    if (_e314 == 8i) {
        let _e316: vec3<f32> = (*b_3);
        param_23 = _e316;
        let _e317: f32 = cspLum_u0028_vf3_u003b((&param_23));
        let _e318: vec3<f32> = (*s_3);
        param_24 = _e318;
        param_25 = _e317;
        let _e319: vec3<f32> = cspSetLum_u0028_vf3_u003b_f1_u003b((&param_24), (&param_25));
        return _e319;
    }
    let _e320: i32 = (*mode);
    if (_e320 == 9i) {
        let _e322: vec3<f32> = (*s_3);
        param_26 = _e322;
        let _e323: f32 = cspLum_u0028_vf3_u003b((&param_26));
        let _e324: vec3<f32> = (*b_3);
        param_27 = _e324;
        param_28 = _e323;
        let _e325: vec3<f32> = cspSetLum_u0028_vf3_u003b_f1_u003b((&param_27), (&param_28));
        return _e325;
    }
    let _e326: vec3<f32> = (*s_3);
    return _e326;
}

fn cspComposite_u0028_vf4_u003b_vf3_u003b_f1_u003b_i1_u003b(backdrop: ptr<function, vec4<f32>>, s_4: ptr<function, vec3<f32>>, as_: ptr<function, f32>, mode_1: ptr<function, i32>) -> vec4<f32> {
    var ab: f32;
    var b_4: vec3<f32>;
    var local: vec3<f32>;
    var mixed: vec3<f32>;
    var param_29: i32;
    var param_30: vec3<f32>;
    var param_31: vec3<f32>;

    let _e272: f32 = (*backdrop)[3u];
    ab = _e272;
    let _e273: f32 = ab;
    if (_e273 > 0f) {
        let _e275: vec4<f32> = (*backdrop);
        let _e277: f32 = ab;
        local = (_e275.xyz / vec3(_e277));
    } else {
        local = vec3<f32>(0f, 0f, 0f);
    }
    let _e280: vec3<f32> = local;
    b_4 = _e280;
    let _e281: f32 = ab;
    let _e283: vec3<f32> = (*s_4);
    let _e285: f32 = ab;
    let _e286: i32 = (*mode_1);
    param_29 = _e286;
    let _e287: vec3<f32> = b_4;
    param_30 = _e287;
    let _e288: vec3<f32> = (*s_4);
    param_31 = _e288;
    let _e289: vec3<f32> = cspBlendMode_u0028_i1_u003b_vf3_u003b_vf3_u003b((&param_29), (&param_30), (&param_31));
    mixed = ((_e283 * (1f - _e281)) + (clamp(_e289, vec3(0f), vec3(1f)) * _e285));
    let _e295: f32 = (*as_);
    let _e296: vec3<f32> = mixed;
    let _e298: f32 = (*as_);
    let _e300: vec4<f32> = (*backdrop);
    let _e303: vec3<f32> = ((_e296 * _e295) + (_e300.xyz * (1f - _e298)));
    let _e304: f32 = (*as_);
    let _e305: f32 = ab;
    let _e306: f32 = (*as_);
    return vec4<f32>(_e303.x, _e303.y, _e303.z, (_e304 + (_e305 * (1f - _e306))));
}

fn cspStopPos_u0028_i1_u003b_i1_u003b(layer: ptr<function, i32>, k: ptr<function, i32>) -> f32 {
    var v: vec4<f32>;
    var m: i32;
    var local_1: f32;
    var local_2: f32;
    var local_3: f32;

    let _e267: i32 = (*layer);
    let _e269: i32 = (*k);
    let _e274: vec4<f32> = unnamed.u_layerPos[((_e267 * 3i) + (_e269 / 4i))];
    v = _e274;
    let _e275: i32 = (*k);
    let _e276: i32 = (*k);
    m = (_e275 - ((_e276 / 4i) * 4i));
    let _e280: i32 = m;
    if (_e280 == 0i) {
        let _e283: f32 = v[0u];
        local_1 = _e283;
    } else {
        let _e284: i32 = m;
        if (_e284 == 1i) {
            let _e287: f32 = v[1u];
            local_2 = _e287;
        } else {
            let _e288: i32 = m;
            if (_e288 == 2i) {
                let _e291: f32 = v[2u];
                local_3 = _e291;
            } else {
                let _e293: f32 = v[3u];
                local_3 = _e293;
            }
            let _e294: f32 = local_3;
            local_2 = _e294;
        }
        let _e295: f32 = local_2;
        local_1 = _e295;
    }
    let _e296: f32 = local_1;
    return _e296;
}

fn cspRampAt_u0028_i1_u003b_f1_u003b(layer_1: ptr<function, i32>, t_1: ptr<function, f32>) -> vec4<f32> {
    var count: i32;
    var base: i32;
    var param_32: i32;
    var param_33: i32;
    var k_1: i32;
    var p1_: f32;
    var param_34: i32;
    var param_35: i32;
    var p0_: f32;
    var param_36: i32;
    var param_37: i32;
    var phi_1293_: bool;

    let _e273: i32 = (*layer_1);
    let _e277: f32 = unnamed.u_layerA[_e273][3u];
    count = i32((_e277 + 0.5f));
    let _e280: i32 = (*layer_1);
    base = (_e280 * 10i);
    let _e282: i32 = count;
    let _e283: bool = (_e282 <= 1i);
    phi_1293_ = _e283;
    if !(_e283) {
        let _e285: f32 = (*t_1);
        let _e286: i32 = (*layer_1);
        param_32 = _e286;
        param_33 = 0i;
        let _e287: f32 = cspStopPos_u0028_i1_u003b_i1_u003b((&param_32), (&param_33));
        phi_1293_ = (_e285 <= _e287);
    }
    let _e290: bool = phi_1293_;
    if _e290 {
        let _e291: i32 = base;
        let _e294: vec4<f32> = unnamed.u_layerColors[_e291];
        return _e294;
    }
    k_1 = 1i;
    loop {
        let _e295: i32 = k_1;
        if (_e295 < 10i) {
            let _e297: i32 = k_1;
            let _e298: i32 = count;
            if (_e297 >= _e298) {
                break;
            }
            let _e300: i32 = (*layer_1);
            param_34 = _e300;
            let _e301: i32 = k_1;
            param_35 = _e301;
            let _e302: f32 = cspStopPos_u0028_i1_u003b_i1_u003b((&param_34), (&param_35));
            p1_ = _e302;
            let _e303: f32 = (*t_1);
            let _e304: f32 = p1_;
            if (_e303 <= _e304) {
                let _e306: i32 = k_1;
                let _e308: i32 = (*layer_1);
                param_36 = _e308;
                param_37 = (_e306 - 1i);
                let _e309: f32 = cspStopPos_u0028_i1_u003b_i1_u003b((&param_36), (&param_37));
                p0_ = _e309;
                let _e310: i32 = base;
                let _e311: i32 = k_1;
                let _e316: vec4<f32> = unnamed.u_layerColors[((_e310 + _e311) - 1i)];
                let _e317: i32 = base;
                let _e318: i32 = k_1;
                let _e322: vec4<f32> = unnamed.u_layerColors[(_e317 + _e318)];
                let _e323: f32 = (*t_1);
                let _e324: f32 = p0_;
                let _e326: f32 = p1_;
                let _e327: f32 = p0_;
                return mix(_e316, _e322, vec4(clamp(((_e323 - _e324) / max((_e326 - _e327), 0.000001f)), 0f, 1f)));
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e334: i32 = k_1;
            k_1 = (_e334 + 1i);
        }
    }
    let _e336: i32 = base;
    let _e337: i32 = count;
    let _e342: vec4<f32> = unnamed.u_layerColors[((_e336 + _e337) - 1i)];
    return _e342;
}

fn cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b(layer_2: ptr<function, i32>, value_2: ptr<function, f32>, range: ptr<function, vec2<f32>>) -> vec4<f32> {
    var r: vec4<f32>;
    var t_2: f32;
    var param_38: i32;
    var param_39: f32;

    let _e267: i32 = (*layer_2);
    let _e270: vec4<f32> = unnamed.u_layerB[_e267];
    r = _e270;
    let _e271: f32 = (*value_2);
    let _e273: f32 = (*range)[0u];
    let _e276: f32 = (*range)[1u];
    let _e278: f32 = (*range)[0u];
    t_2 = clamp(((_e271 - _e273) / max((_e276 - _e278), 0.000001f)), 0f, 1f);
    let _e283: f32 = t_2;
    let _e286: f32 = r[2u];
    t_2 = pow(max(_e283, 0f), _e286);
    let _e289: f32 = r[3u];
    if (_e289 >= 2f) {
        let _e291: f32 = t_2;
        let _e293: f32 = r[3u];
        let _e297: f32 = r[3u];
        let _e301: f32 = r[3u];
        t_2 = (min(floor((_e291 * _e293)), (_e297 - 1f)) / (_e301 - 1f));
    }
    let _e304: i32 = (*layer_2);
    param_38 = _e304;
    let _e305: f32 = t_2;
    param_39 = _e305;
    let _e306: vec4<f32> = cspRampAt_u0028_i1_u003b_f1_u003b((&param_38), (&param_39));
    return _e306;
}

fn cspPalette_u0028_i1_u003b_f1_u003b(layer_3: ptr<function, i32>, value_3: ptr<function, f32>) -> vec4<f32> {
    var param_40: i32;
    var param_41: f32;
    var param_42: vec2<f32>;

    let _e265: i32 = (*layer_3);
    let _e266: i32 = (*layer_3);
    param_40 = _e266;
    let _e267: f32 = (*value_3);
    param_41 = _e267;
    let _e270: vec4<f32> = unnamed.u_layerB[_e265];
    param_42 = _e270.xy;
    let _e272: vec4<f32> = cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b((&param_40), (&param_41), (&param_42));
    return _e272;
}

fn cspWaterColour_u0028_i1_u003b_f1_u003b_vf2_u003b(layer_4: ptr<function, i32>, value_4: ptr<function, f32>, range_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var t_3: f32;
    var r_1: vec4<f32>;
    var deep: vec3<f32>;
    var mid: vec3<f32>;
    var shallow: vec3<f32>;
    var local_4: vec3<f32>;
    var param_43: i32;
    var param_44: f32;

    let _e271: f32 = (*value_4);
    let _e273: f32 = (*range_1)[0u];
    let _e276: f32 = (*range_1)[1u];
    let _e278: f32 = (*range_1)[0u];
    t_3 = clamp(((_e271 - _e273) / max(0.000001f, (_e276 - _e278))), 0f, 1f);
    let _e283: i32 = (*layer_4);
    let _e286: vec4<f32> = unnamed.u_layerB[_e283];
    r_1 = _e286;
    let _e287: f32 = t_3;
    let _e290: f32 = r_1[2u];
    t_3 = pow(max(_e287, 0f), _e290);
    let _e293: f32 = r_1[3u];
    if (_e293 >= 2f) {
        let _e295: f32 = t_3;
        let _e297: f32 = r_1[3u];
        let _e301: f32 = r_1[3u];
        let _e305: f32 = r_1[3u];
        t_3 = (min(floor((_e295 * _e297)), (_e301 - 1f)) / (_e305 - 1f));
    }
    deep = vec3<f32>(0.011764706f, 0.015686275f, 0.36862746f);
    mid = vec3<f32>(0f, 0.46666667f, 0.7137255f);
    shallow = vec3<f32>(0.5647059f, 0.8784314f, 0.9372549f);
    let _e308: f32 = t_3;
    if (_e308 < 0.5f) {
        let _e310: vec3<f32> = deep;
        let _e311: vec3<f32> = mid;
        let _e312: f32 = t_3;
        local_4 = mix(_e310, _e311, vec3((_e312 * 2f)));
    } else {
        let _e316: vec3<f32> = mid;
        let _e317: vec3<f32> = shallow;
        let _e318: f32 = t_3;
        local_4 = mix(_e316, _e317, vec3(((_e318 - 0.5f) * 2f)));
    }
    let _e323: vec3<f32> = local_4;
    let _e324: i32 = (*layer_4);
    param_43 = _e324;
    let _e325: f32 = t_3;
    param_44 = _e325;
    let _e326: vec4<f32> = cspRampAt_u0028_i1_u003b_f1_u003b((&param_43), (&param_44));
    return vec4<f32>(_e323.x, _e323.y, _e323.z, _e326.w);
}

fn cspWaterClass_u0028_vf2_u003b(merc: ptr<function, vec2<f32>>) -> u32 {
    var latitude: f32;
    var q: vec2<i32>;
    var packed: vec4<u32>;

    let _e265: f32 = (*merc)[1u];
    latitude = degrees(atan(sinh((3.1415927f * (1f - (2f * _e265))))));
    let _e273: f32 = (*merc)[0u];
    let _e279: f32 = latitude;
    q = vec2<i32>(i32(min(16383f, floor((fract(_e273) * 16384f)))), i32(clamp(floor((((90f - _e279) / 180f) * 8192f)), 0f, 8191f)));
    let _e288: i32 = q[0u];
    let _e291: i32 = q[1u];
    let _e294: vec4<u32> = textureLoad(u_waterMask, vec2<i32>((_e288 / 8i), (_e291 / 4i)), 0i);
    packed = _e294;
    let _e296: i32 = q[1u];
    let _e305: u32 = packed[(_e296 - (i32(floor((f32(_e296) / f32(4i)))) * 4i))];
    let _e307: i32 = q[0u];
    return ((_e305 >> bitcast<u32>(bitcast<u32>((14i - (2i * (_e307 - (i32(floor((f32(_e307) / f32(8i)))) * 8i))))))) & 3u);
}

fn cspCustom32_u0028_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(c_4: ptr<function, CspCtx>) -> vec2<f32> {
    let _e262: f32 = (*c_4).height;
    let _e269: f32 = (*c_4).height;
    let _e271: f32 = (*c_4).height;
    return vec2<f32>(((_e262 - (floor((_e262 / 17f)) * 17f)) / 17f), select(0f, 1f, (_e269 == _e271)));
}

fn cspCustomStyle_u0028_i1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(style: ptr<function, i32>, c_5: ptr<function, CspCtx>) -> vec2<f32> {
    var param_45: CspCtx;

    let _e263: i32 = (*style);
    if (_e263 == 32i) {
        let _e265: CspCtx = (*c_5);
        param_45 = _e265;
        let _e266: vec2<f32> = cspCustom32_u0028_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b((&param_45));
        let _e267: CspCtx = param_45;
        (*c_5) = _e267;
        return _e266;
    }
    return vec2<f32>(0f, 0f);
}

fn cspMultiShade_u0028_f1_u003b_f1_u003b(dx_2: ptr<function, f32>, dy_2: ptr<function, f32>) -> f32 {
    var aspect: f32;
    var param_46: f32;
    var param_47: f32;
    var sum: f32;
    var total: f32;
    var index: i32;
    var az_1: f32;
    var s_5: f32;
    var weight: f32;
    var local_5: f32;
    var param_48: f32;
    var param_49: f32;
    var param_50: f32;

    let _e275: f32 = (*dx_2);
    param_46 = _e275;
    let _e276: f32 = (*dy_2);
    param_47 = _e276;
    let _e277: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_46), (&param_47));
    aspect = _e277;
    sum = 0f;
    total = 0f;
    index = 0i;
    loop {
        let _e278: i32 = index;
        if (_e278 < 4i) {
            let _e281: f32 = unnamed.u_sunAzimuth;
            let _e283: i32 = index;
            az_1 = ((_e281 - 90f) + (45f * f32(_e283)));
            let _e287: f32 = aspect;
            let _e288: f32 = az_1;
            s_5 = sin(radians((_e287 - (_e288 - (floor((_e288 / 360f)) * 360f)))));
            let _e296: f32 = (*dx_2);
            let _e297: f32 = (*dy_2);
            if (length(vec2<f32>(_e296, _e297)) < 0.000000000001f) {
                local_5 = 1f;
            } else {
                let _e301: f32 = s_5;
                let _e302: f32 = s_5;
                local_5 = (_e301 * _e302);
            }
            let _e304: f32 = local_5;
            weight = _e304;
            let _e305: f32 = weight;
            let _e306: f32 = (*dx_2);
            param_48 = _e306;
            let _e307: f32 = (*dy_2);
            param_49 = _e307;
            let _e308: f32 = az_1;
            param_50 = _e308;
            let _e309: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_48), (&param_49), (&param_50));
            let _e311: f32 = sum;
            sum = (_e311 + (_e305 * _e309));
            let _e313: f32 = weight;
            let _e314: f32 = total;
            total = (_e314 + _e313);
            continue;
        } else {
            break;
        }
        continuing {
            let _e316: i32 = index;
            index = (_e316 + 1i);
        }
    }
    let _e319: f32 = unnamed.u_ambient;
    let _e321: f32 = unnamed.u_ambient;
    let _e323: f32 = sum;
    let _e325: f32 = total;
    return (_e319 + (((1f - _e321) * _e323) / max(_e325, 0.00001f)));
}

fn cspShadeAt_u0028_f1_u003b_f1_u003b_f1_u003b(dx_3: ptr<function, f32>, dy_3: ptr<function, f32>, azimuth_1: ptr<function, f32>) -> f32 {
    var param_51: f32;
    var param_52: f32;
    var param_53: f32;

    let _e267: f32 = unnamed.u_ambient;
    let _e269: f32 = unnamed.u_ambient;
    let _e271: f32 = (*dx_3);
    param_51 = _e271;
    let _e272: f32 = (*dy_3);
    param_52 = _e272;
    let _e273: f32 = (*azimuth_1);
    param_53 = _e273;
    let _e274: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_51), (&param_52), (&param_53));
    return (_e267 + ((1f - _e269) * _e274));
}

fn cspLayerValue_u0028_i1_u003b_f1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(style_1: ptr<function, i32>, param_54: ptr<function, f32>, c_6: ptr<function, CspCtx>) -> vec2<f32> {
    var param_55: f32;
    var param_56: f32;
    var param_57: f32;
    var param_58: f32;
    var param_59: f32;
    var local_6: vec2<f32>;
    var local_7: vec2<f32>;
    var interval: f32;
    var local_8: f32;
    var local_9: f32;
    var local_10: f32;
    var local_11: f32;
    var perPixel: f32;
    var spacing: f32;
    var multiple: f32;
    var distanceToLine: f32;
    var lineWidth: f32;
    var indexLine: bool;
    var param_60: i32;
    var param_61: CspCtx;

    let _e283: i32 = (*style_1);
    if (_e283 == 0i) {
        let _e286: f32 = (*c_6).sdx;
        param_55 = _e286;
        let _e288: f32 = (*c_6).sdy;
        param_56 = _e288;
        let _e290: f32 = unnamed.u_sunAzimuth;
        param_57 = _e290;
        let _e291: f32 = cspShadeAt_u0028_f1_u003b_f1_u003b_f1_u003b((&param_55), (&param_56), (&param_57));
        return vec2<f32>(_e291, 1f);
    }
    let _e293: i32 = (*style_1);
    if (_e293 == 1i) {
        let _e296: f32 = (*c_6).sdx;
        param_58 = _e296;
        let _e298: f32 = (*c_6).sdy;
        param_59 = _e298;
        let _e299: f32 = cspMultiShade_u0028_f1_u003b_f1_u003b((&param_58), (&param_59));
        return vec2<f32>(_e299, 1f);
    }
    let _e301: i32 = (*style_1);
    if (_e301 == 2i) {
        let _e304: f32 = (*c_6).slope;
        return vec2<f32>(_e304, 1f);
    }
    let _e306: i32 = (*style_1);
    if (_e306 == 3i) {
        let _e309: f32 = (*c_6).aspect;
        if (_e309 < 0f) {
            local_6 = vec2<f32>(0f, 0f);
        } else {
            let _e312: f32 = (*c_6).aspect;
            local_6 = vec2<f32>(_e312, 1f);
        }
        let _e314: vec2<f32> = local_6;
        return _e314;
    }
    let _e315: i32 = (*style_1);
    if (_e315 == 4i) {
        let _e318: f32 = (*c_6).aspect;
        if (_e318 < 0f) {
            local_7 = vec2<f32>(0f, 0f);
        } else {
            let _e321: f32 = (*c_6).aspect;
            local_7 = vec2<f32>(cos(radians(_e321)), 1f);
        }
        let _e325: vec2<f32> = local_7;
        return _e325;
    }
    let _e326: i32 = (*style_1);
    if (_e326 == 5i) {
        let _e329: f32 = (*c_6).height;
        return vec2<f32>(_e329, 1f);
    }
    let _e331: i32 = (*style_1);
    if (_e331 == 10i) {
        let _e334: f32 = (*c_6).height;
        let _e336: f32 = (*c_6).base;
        return vec2<f32>(max(0f, (_e334 - _e336)), 1f);
    }
    let _e340: i32 = (*style_1);
    let _e342: i32 = (*style_1);
    let _e345: i32 = (*style_1);
    if (((_e340 >= 6i) && (_e342 <= 9i)) || (_e345 == 11i)) {
        let _e348: i32 = (*style_1);
        if (_e348 == 6i) {
            local_8 = 2f;
        } else {
            let _e350: i32 = (*style_1);
            if (_e350 == 7i) {
                local_9 = 5f;
            } else {
                let _e352: i32 = (*style_1);
                if (_e352 == 8i) {
                    local_10 = 10f;
                } else {
                    let _e354: i32 = (*style_1);
                    if (_e354 == 9i) {
                        local_11 = 25f;
                    } else {
                        let _e356: f32 = (*param_54);
                        local_11 = max(0.5f, _e356);
                    }
                    let _e358: f32 = local_11;
                    local_10 = _e358;
                }
                let _e359: f32 = local_10;
                local_9 = _e359;
            }
            let _e360: f32 = local_9;
            local_8 = _e360;
        }
        let _e361: f32 = local_8;
        interval = _e361;
        let _e363: f32 = (*c_6).dx;
        let _e365: f32 = (*c_6).dy;
        let _e369: f32 = (*c_6).res;
        perPixel = ((length(vec2<f32>(_e363, _e365)) * _e369) * 3.28084f);
        let _e372: f32 = perPixel;
        if (_e372 > 0f) {
            let _e374: f32 = interval;
            let _e375: f32 = perPixel;
            spacing = (_e374 / _e375);
            let _e377: f32 = spacing;
            if (_e377 < 3f) {
                let _e379: f32 = spacing;
                if ((_e379 * 5f) >= 3f) {
                    let _e382: f32 = interval;
                    interval = (_e382 * 5f);
                } else {
                    return vec2<f32>(0f, 0f);
                }
            }
        }
        let _e385: f32 = (*c_6).height;
        let _e387: f32 = interval;
        multiple = ((_e385 * 3.28084f) / _e387);
        let _e389: f32 = multiple;
        let _e390: f32 = multiple;
        let _e394: f32 = interval;
        distanceToLine = (abs((_e389 - round(_e390))) * _e394);
        let _e396: f32 = interval;
        let _e398: f32 = perPixel;
        lineWidth = max(0.35f, min((_e396 * 0.5f), (_e398 * 0.7f)));
        let _e402: f32 = distanceToLine;
        let _e403: f32 = lineWidth;
        if (_e402 >= _e403) {
            return vec2<f32>(0f, 0f);
        }
        let _e405: f32 = multiple;
        let _e406: f32 = round(_e405);
        indexLine = (abs((_e406 - (floor((_e406 / 5f)) * 5f))) < 0.5f);
        let _e413: bool = indexLine;
        return vec2<f32>(select(0f, 1f, _e413), 1f);
    }
    let _e416: i32 = (*style_1);
    if (_e416 >= 32i) {
        let _e418: i32 = (*style_1);
        param_60 = _e418;
        let _e419: CspCtx = (*c_6);
        param_61 = _e419;
        let _e420: vec2<f32> = cspCustomStyle_u0028_i1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b((&param_60), (&param_61));
        let _e421: CspCtx = param_61;
        (*c_6) = _e421;
        return _e420;
    }
    return vec2<f32>(0f, 0f);
}

fn csk_isinf_u0028_f1_u003b(v_1: ptr<function, f32>) -> bool {
    let _e261: f32 = (*v_1);
    return ((bitcast<u32>(_e261) & 2147483647u) == 2139095040u);
}

fn csk_isnan_u0028_f1_u003b(v_2: ptr<function, f32>) -> bool {
    let _e261: f32 = (*v_2);
    return ((bitcast<u32>(_e261) & 2147483647u) > 2139095040u);
}

fn csk_aux_u0028_t21_u003b_vi2_u003b_f1_u003b(image: texture_2d<f32>, p: ptr<function, vec2<i32>>, v_3: ptr<function, f32>) -> bool {
    var a_1: vec2<f32>;
    var param_62: f32;
    var param_63: f32;
    var phi_316_: bool;
    var phi_323_: bool;

    let _e266: vec2<i32> = (*p);
    let _e267: vec2<u32> = textureDimensions(image, 0i);
    let _e272: vec4<f32> = textureLoad(image, clamp(_e266, vec2<i32>(0i, 0i), (vec2<i32>(_e267) - vec2(1i))), 0i);
    a_1 = _e272.xy;
    let _e275: f32 = a_1[0u];
    (*v_3) = _e275;
    let _e277: f32 = a_1[1u];
    let _e278: bool = (_e277 > 0f);
    phi_316_ = _e278;
    if _e278 {
        let _e279: f32 = (*v_3);
        param_62 = _e279;
        let _e280: bool = csk_isnan_u0028_f1_u003b((&param_62));
        phi_316_ = !(_e280);
    }
    let _e283: bool = phi_316_;
    phi_323_ = _e283;
    if _e283 {
        let _e284: f32 = (*v_3);
        param_63 = _e284;
        let _e285: bool = csk_isinf_u0028_f1_u003b((&param_63));
        phi_323_ = !(_e285);
    }
    let _e288: bool = phi_323_;
    return _e288;
}

fn csp_landBase_u0028_vi2_u003b_f1_u003b(p_1: ptr<function, vec2<i32>>, v_4: ptr<function, f32>) -> bool {
    var param_64: vec2<i32>;
    var param_65: f32;

    let _e264: vec2<i32> = (*p_1);
    param_64 = _e264;
    let _e265: bool = csk_aux_u0028_t21_u003b_vi2_u003b_f1_u003b(csk_land, (&param_64), (&param_65));
    let _e266: f32 = param_65;
    (*v_4) = _e266;
    return _e265;
}

fn csp_base_u0028_vi2_u003b_f1_u003b(p_2: ptr<function, vec2<i32>>, v_5: ptr<function, f32>) -> bool {
    var param_66: vec2<i32>;
    var param_67: f32;

    let _e264: vec2<i32> = (*p_2);
    param_66 = _e264;
    let _e265: bool = csk_aux_u0028_t21_u003b_vi2_u003b_f1_u003b(csk_base, (&param_66), (&param_67));
    let _e266: f32 = param_67;
    (*v_5) = _e266;
    return _e265;
}

fn csp_blur_u0028_vi2_u003b_f1_u003b(p_3: ptr<function, vec2<i32>>, v_6: ptr<function, f32>) -> bool {
    var param_68: vec2<i32>;
    var param_69: f32;

    let _e264: vec2<i32> = (*p_3);
    param_68 = _e264;
    let _e265: bool = csk_aux_u0028_t21_u003b_vi2_u003b_f1_u003b(csk_blur, (&param_68), (&param_69));
    let _e266: f32 = param_69;
    (*v_6) = _e266;
    return _e265;
}

fn csp_size_u0028_() -> vec2<i32> {
    let _e260: vec2<u32> = textureDimensions(csk_heights, 0i);
    return vec2<i32>(_e260);
}

fn csk_clamp_u0028_vi2_u003b(p_4: ptr<function, vec2<i32>>) -> vec2<i32> {
    let _e261: vec2<i32> = (*p_4);
    let _e262: vec2<i32> = csp_size_u0028_();
    return clamp(_e261, vec2<i32>(0i, 0i), (_e262 - vec2(1i)));
}

fn csp_height_u0028_vi2_u003b(p_5: ptr<function, vec2<i32>>) -> f32 {
    var param_70: vec2<i32>;

    let _e262: vec2<i32> = (*p_5);
    param_70 = _e262;
    let _e263: vec2<i32> = csk_clamp_u0028_vi2_u003b((&param_70));
    let _e264: vec4<f32> = textureLoad(csk_heights, _e263, 0i);
    return _e264.x;
}

fn cspH_u0028_vi2_u003b(q_1: ptr<function, vec2<i32>>) -> f32 {
    var h: f32;
    var param_71: vec2<i32>;
    var b_5: f32;
    var param_72: vec2<i32>;
    var param_73: f32;
    var phi_1207_: bool;

    let _e266: vec2<i32> = (*q_1);
    param_71 = _e266;
    let _e267: f32 = csp_height_u0028_vi2_u003b((&param_71));
    h = _e267;
    let _e269: f32 = unnamed.u_detail;
    let _e270: bool = (_e269 != 0f);
    phi_1207_ = _e270;
    if _e270 {
        let _e271: vec2<i32> = (*q_1);
        param_72 = _e271;
        let _e272: bool = csp_blur_u0028_vi2_u003b_f1_u003b((&param_72), (&param_73));
        let _e273: f32 = param_73;
        b_5 = _e273;
        phi_1207_ = _e272;
    }
    let _e275: bool = phi_1207_;
    if _e275 {
        let _e277: f32 = unnamed.u_detail;
        let _e278: f32 = h;
        let _e279: f32 = b_5;
        let _e282: f32 = h;
        h = (_e282 + (_e277 * (_e278 - _e279)));
    }
    let _e284: f32 = h;
    return _e284;
}

fn csp_rank_u0028_vi2_u003b(p_6: ptr<function, vec2<i32>>) -> i32 {
    var param_74: vec2<i32>;

    let _e262: vec2<i32> = (*p_6);
    param_74 = _e262;
    let _e263: vec2<i32> = csk_clamp_u0028_vi2_u003b((&param_74));
    let _e264: vec4<u32> = textureLoad(csk_ranks, _e263, 0i);
    return bitcast<i32>(_e264.x);
}

fn csp_valid_u0028_vi2_u003b(p_7: ptr<function, vec2<i32>>) -> bool {
    var h_1: f32;
    var param_75: vec2<i32>;
    var param_76: vec2<i32>;
    var param_77: f32;
    var param_78: f32;
    var phi_279_: bool;
    var phi_286_: bool;

    let _e266: vec2<i32> = (*p_7);
    param_75 = _e266;
    let _e267: f32 = csp_height_u0028_vi2_u003b((&param_75));
    h_1 = _e267;
    let _e268: vec2<i32> = (*p_7);
    param_76 = _e268;
    let _e269: i32 = csp_rank_u0028_vi2_u003b((&param_76));
    let _e270: bool = (_e269 > 0i);
    phi_279_ = _e270;
    if _e270 {
        let _e271: f32 = h_1;
        param_77 = _e271;
        let _e272: bool = csk_isnan_u0028_f1_u003b((&param_77));
        phi_279_ = !(_e272);
    }
    let _e275: bool = phi_279_;
    phi_286_ = _e275;
    if _e275 {
        let _e276: f32 = h_1;
        param_78 = _e276;
        let _e277: bool = csk_isinf_u0028_f1_u003b((&param_78));
        phi_286_ = !(_e277);
    }
    let _e280: bool = phi_286_;
    let _e281: f32 = h_1;
    return (_e280 && (_e281 > -100000000000000000000f));
}

fn cspStack_u0028_vi2_u003b_f1_u003b_f1_u003b_f1_u003b_f1_u003b_vf2_u003b(p_8: ptr<function, vec2<i32>>, value_5: ptr<function, f32>, groundRes: ptr<function, f32>, cosB: ptr<function, f32>, sinB: ptr<function, f32>, merc_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var px: vec2<i32>;
    var py: vec2<i32>;
    var param_79: vec2<i32>;
    var param_80: vec2<i32>;
    var param_81: vec2<i32>;
    var param_82: vec2<i32>;
    var param_83: vec2<i32>;
    var param_84: vec2<i32>;
    var param_85: vec2<i32>;
    var param_86: vec2<i32>;
    var c_7: CspCtx;
    var a_2: f32;
    var param_87: vec2<i32>;
    var b_6: f32;
    var param_88: vec2<i32>;
    var cc: f32;
    var param_89: vec2<i32>;
    var d_1: f32;
    var param_90: vec2<i32>;
    var f: f32;
    var param_91: vec2<i32>;
    var g: f32;
    var param_92: vec2<i32>;
    var q_2: f32;
    var param_93: vec2<i32>;
    var k_2: f32;
    var param_94: vec2<i32>;
    var dxS: f32;
    var dyS: f32;
    var zFactor: f32;
    var local_12: f32;
    var param_95: f32;
    var param_96: f32;
    var legacyBase: f32;
    var baseValue: f32;
    var param_97: vec2<i32>;
    var param_98: f32;
    var local_13: f32;
    var landBase: f32;
    var landBaseValue: f32;
    var param_99: vec2<i32>;
    var param_100: f32;
    var local_14: f32;
    var acc: vec4<f32>;
    var i: i32;
    var layer_5: vec4<f32>;
    var style_2: i32;
    var param_101: f32;
    var flags: i32;
    var v_7: vec2<f32>;
    var param_102: i32;
    var param_103: f32;
    var param_104: CspCtx;
    var waterClass: u32;
    var local_15: u32;
    var param_105: vec2<f32>;
    var colour: vec4<f32>;
    var local_16: vec4<f32>;
    var param_106: i32;
    var param_107: f32;
    var param_108: vec2<f32>;
    var local_17: vec4<f32>;
    var param_109: i32;
    var param_110: f32;
    var param_111: vec2<f32>;
    var param_112: i32;
    var param_113: f32;
    var shade: f32;
    var param_114: f32;
    var param_115: f32;
    var param_116: f32;
    var alpha: f32;
    var param_117: vec4<f32>;
    var param_118: vec3<f32>;
    var param_119: f32;
    var param_120: i32;
    var straight_1: vec3<f32>;
    var param_121: vec3<f32>;
    var phi_2239_: bool;
    var phi_2249_: bool;
    var phi_2257_: bool;
    var phi_2265_: bool;
    var phi_2275_: bool;
    var phi_2283_: bool;
    var phi_2293_: bool;
    var phi_2584_: bool;
    var phi_2601_: bool;
    var phi_2624_: bool;

    px = vec2<i32>(1i, 0i);
    py = vec2<i32>(0i, 1i);
    let _e344: vec2<i32> = (*p_8);
    let _e345: vec2<i32> = px;
    let _e347: vec2<i32> = py;
    param_79 = ((_e344 - _e345) - _e347);
    let _e349: bool = csp_valid_u0028_vi2_u003b((&param_79));
    phi_2239_ = _e349;
    if _e349 {
        let _e350: vec2<i32> = (*p_8);
        let _e351: vec2<i32> = py;
        param_80 = (_e350 - _e351);
        let _e353: bool = csp_valid_u0028_vi2_u003b((&param_80));
        phi_2239_ = _e353;
    }
    let _e355: bool = phi_2239_;
    phi_2249_ = _e355;
    if _e355 {
        let _e356: vec2<i32> = (*p_8);
        let _e357: vec2<i32> = px;
        let _e359: vec2<i32> = py;
        param_81 = ((_e356 + _e357) - _e359);
        let _e361: bool = csp_valid_u0028_vi2_u003b((&param_81));
        phi_2249_ = _e361;
    }
    let _e363: bool = phi_2249_;
    phi_2257_ = _e363;
    if _e363 {
        let _e364: vec2<i32> = (*p_8);
        let _e365: vec2<i32> = px;
        param_82 = (_e364 - _e365);
        let _e367: bool = csp_valid_u0028_vi2_u003b((&param_82));
        phi_2257_ = _e367;
    }
    let _e369: bool = phi_2257_;
    phi_2265_ = _e369;
    if _e369 {
        let _e370: vec2<i32> = (*p_8);
        let _e371: vec2<i32> = px;
        param_83 = (_e370 + _e371);
        let _e373: bool = csp_valid_u0028_vi2_u003b((&param_83));
        phi_2265_ = _e373;
    }
    let _e375: bool = phi_2265_;
    phi_2275_ = _e375;
    if _e375 {
        let _e376: vec2<i32> = (*p_8);
        let _e377: vec2<i32> = px;
        let _e379: vec2<i32> = py;
        param_84 = ((_e376 - _e377) + _e379);
        let _e381: bool = csp_valid_u0028_vi2_u003b((&param_84));
        phi_2275_ = _e381;
    }
    let _e383: bool = phi_2275_;
    phi_2283_ = _e383;
    if _e383 {
        let _e384: vec2<i32> = (*p_8);
        let _e385: vec2<i32> = py;
        param_85 = (_e384 + _e385);
        let _e387: bool = csp_valid_u0028_vi2_u003b((&param_85));
        phi_2283_ = _e387;
    }
    let _e389: bool = phi_2283_;
    phi_2293_ = _e389;
    if _e389 {
        let _e390: vec2<i32> = (*p_8);
        let _e391: vec2<i32> = px;
        let _e393: vec2<i32> = py;
        param_86 = ((_e390 + _e391) + _e393);
        let _e395: bool = csp_valid_u0028_vi2_u003b((&param_86));
        phi_2293_ = _e395;
    }
    let _e397: bool = phi_2293_;
    if !(_e397) {
        return vec4<f32>(0f, 0f, 0f, 0f);
    }
    let _e399: vec2<i32> = (*p_8);
    c_7.p = _e399;
    let _e401: f32 = (*value_5);
    c_7.height = _e401;
    let _e403: f32 = (*groundRes);
    c_7.res = _e403;
    c_7.dx = 0f;
    c_7.dy = 0f;
    c_7.sdx = 0f;
    c_7.sdy = 0f;
    c_7.slope = 0f;
    c_7.aspect = -1f;
    let _e412: f32 = unnamed.u_stackGradient;
    if (_e412 > 0.5f) {
        let _e414: vec2<i32> = (*p_8);
        let _e415: vec2<i32> = px;
        let _e417: vec2<i32> = py;
        param_87 = ((_e414 - _e415) - _e417);
        let _e419: f32 = cspH_u0028_vi2_u003b((&param_87));
        a_2 = _e419;
        let _e420: vec2<i32> = (*p_8);
        let _e421: vec2<i32> = py;
        param_88 = (_e420 - _e421);
        let _e423: f32 = cspH_u0028_vi2_u003b((&param_88));
        b_6 = _e423;
        let _e424: vec2<i32> = (*p_8);
        let _e425: vec2<i32> = px;
        let _e427: vec2<i32> = py;
        param_89 = ((_e424 + _e425) - _e427);
        let _e429: f32 = cspH_u0028_vi2_u003b((&param_89));
        cc = _e429;
        let _e430: vec2<i32> = (*p_8);
        let _e431: vec2<i32> = px;
        param_90 = (_e430 - _e431);
        let _e433: f32 = cspH_u0028_vi2_u003b((&param_90));
        d_1 = _e433;
        let _e434: vec2<i32> = (*p_8);
        let _e435: vec2<i32> = px;
        param_91 = (_e434 + _e435);
        let _e437: f32 = cspH_u0028_vi2_u003b((&param_91));
        f = _e437;
        let _e438: vec2<i32> = (*p_8);
        let _e439: vec2<i32> = px;
        let _e441: vec2<i32> = py;
        param_92 = ((_e438 - _e439) + _e441);
        let _e443: f32 = cspH_u0028_vi2_u003b((&param_92));
        g = _e443;
        let _e444: vec2<i32> = (*p_8);
        let _e445: vec2<i32> = py;
        param_93 = (_e444 + _e445);
        let _e447: f32 = cspH_u0028_vi2_u003b((&param_93));
        q_2 = _e447;
        let _e448: vec2<i32> = (*p_8);
        let _e449: vec2<i32> = px;
        let _e451: vec2<i32> = py;
        param_94 = ((_e448 + _e449) + _e451);
        let _e453: f32 = cspH_u0028_vi2_u003b((&param_94));
        k_2 = _e453;
        let _e454: f32 = cc;
        let _e455: f32 = f;
        let _e458: f32 = k_2;
        let _e460: f32 = a_2;
        let _e461: f32 = d_1;
        let _e464: f32 = g;
        let _e467: f32 = (*groundRes);
        dxS = ((((_e454 + (2f * _e455)) + _e458) - ((_e460 + (2f * _e461)) + _e464)) / (8f * _e467));
        let _e470: f32 = g;
        let _e471: f32 = q_2;
        let _e474: f32 = k_2;
        let _e476: f32 = a_2;
        let _e477: f32 = b_6;
        let _e480: f32 = cc;
        let _e483: f32 = (*groundRes);
        dyS = ((((_e470 + (2f * _e471)) + _e474) - ((_e476 + (2f * _e477)) + _e480)) / (8f * _e483));
        let _e486: f32 = dxS;
        let _e487: f32 = (*cosB);
        let _e489: f32 = dyS;
        let _e490: f32 = (*sinB);
        c_7.dx = ((_e486 * _e487) + (_e489 * _e490));
        let _e494: f32 = dxS;
        let _e495: f32 = (*sinB);
        let _e497: f32 = dyS;
        let _e498: f32 = (*cosB);
        c_7.dy = -(((_e494 * _e495) - (_e497 * _e498)));
        let _e503: f32 = (*groundRes);
        zFactor = (1f + (0.024f * pow(max(_e503, 0f), 0.664f)));
        let _e509: f32 = c_7.dx;
        let _e510: f32 = zFactor;
        let _e513: f32 = unnamed.u_reliefExag;
        c_7.sdx = ((_e509 * _e510) * _e513);
        let _e517: f32 = c_7.dy;
        let _e518: f32 = zFactor;
        let _e521: f32 = unnamed.u_reliefExag;
        c_7.sdy = ((_e517 * _e518) * _e521);
        let _e525: f32 = c_7.dx;
        let _e527: f32 = c_7.dy;
        c_7.slope = degrees(atan(length(vec2<f32>(_e525, _e527))));
        let _e534: f32 = c_7.dx;
        let _e536: f32 = c_7.dy;
        if (length(vec2<f32>(_e534, _e536)) <= 0.008726868f) {
            local_12 = -1f;
        } else {
            let _e541: f32 = c_7.dx;
            param_95 = _e541;
            let _e543: f32 = c_7.dy;
            param_96 = _e543;
            let _e544: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_95), (&param_96));
            local_12 = _e544;
        }
        let _e545: f32 = local_12;
        c_7.aspect = _e545;
    }
    let _e547: vec2<i32> = (*p_8);
    param_97 = _e547;
    let _e548: bool = csp_base_u0028_vi2_u003b_f1_u003b((&param_97), (&param_98));
    let _e549: f32 = param_98;
    baseValue = _e549;
    if _e548 {
        let _e550: f32 = baseValue;
        local_13 = _e550;
    } else {
        let _e552: f32 = unnamed.u_remFlatBase;
        local_13 = _e552;
    }
    let _e553: f32 = local_13;
    legacyBase = _e553;
    let _e554: vec2<i32> = (*p_8);
    param_99 = _e554;
    let _e555: bool = csp_landBase_u0028_vi2_u003b_f1_u003b((&param_99), (&param_100));
    let _e556: f32 = param_100;
    landBaseValue = _e556;
    if _e555 {
        let _e557: f32 = landBaseValue;
        local_14 = _e557;
    } else {
        let _e559: f32 = unnamed.u_remLandBase;
        local_14 = _e559;
    }
    let _e560: f32 = local_14;
    landBase = _e560;
    acc = vec4<f32>(0f, 0f, 0f, 0f);
    i = 0i;
    loop {
        let _e561: i32 = i;
        if (_e561 < 4i) {
            let _e563: i32 = i;
            let _e566: f32 = unnamed.u_layerCount;
            if (f32(_e563) >= _e566) {
                break;
            }
            let _e568: i32 = i;
            let _e571: vec4<f32> = unnamed.u_layerA[_e568];
            layer_5 = _e571;
            let _e573: f32 = layer_5[0u];
            style_2 = i32((_e573 + 0.5f));
            let _e576: i32 = i;
            let _e580: f32 = unnamed.u_layerC[_e576][0u];
            param_101 = _e580;
            let _e581: i32 = i;
            let _e585: f32 = unnamed.u_layerC[_e581][1u];
            flags = i32((_e585 + 0.5f));
            let _e588: i32 = flags;
            let _e591: f32 = landBase;
            let _e592: f32 = legacyBase;
            c_7.base = select(_e592, _e591, ((_e588 & 2i) != 0i));
            let _e595: i32 = style_2;
            param_102 = _e595;
            let _e596: f32 = param_101;
            param_103 = _e596;
            let _e597: CspCtx = c_7;
            param_104 = _e597;
            let _e598: vec2<f32> = cspLayerValue_u0028_i1_u003b_f1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b((&param_102), (&param_103), (&param_104));
            let _e599: CspCtx = param_104;
            c_7 = _e599;
            v_7 = _e598;
            let _e601: f32 = v_7[1u];
            if (_e601 <= 0f) {
                continue;
            }
            let _e603: i32 = style_2;
            let _e605: i32 = style_2;
            let _e607: bool = ((_e603 == 5i) || (_e605 == 10i));
            phi_2584_ = _e607;
            if _e607 {
                let _e608: i32 = flags;
                phi_2584_ = ((_e608 & 5i) != 0i);
            }
            let _e612: bool = phi_2584_;
            if _e612 {
                let _e613: vec2<f32> = (*merc_1);
                param_105 = _e613;
                let _e614: u32 = cspWaterClass_u0028_vf2_u003b((&param_105));
                local_15 = _e614;
            } else {
                local_15 = 0u;
            }
            let _e615: u32 = local_15;
            waterClass = _e615;
            let _e616: u32 = waterClass;
            let _e617: bool = (_e616 == 1u);
            phi_2601_ = _e617;
            if _e617 {
                let _e618: i32 = flags;
                phi_2601_ = ((_e618 & 1i) != 0i);
            }
            let _e622: bool = phi_2601_;
            if _e622 {
                let _e623: i32 = i;
                let _e624: i32 = i;
                param_106 = _e624;
                let _e626: f32 = c_7.height;
                param_107 = _e626;
                let _e629: vec4<f32> = unnamed.u_layerC[_e623];
                param_108 = _e629.zw;
                let _e631: vec4<f32> = cspWaterColour_u0028_i1_u003b_f1_u003b_vf2_u003b((&param_106), (&param_107), (&param_108));
                local_16 = _e631;
            } else {
                let _e632: u32 = waterClass;
                let _e633: bool = (_e632 == 2u);
                phi_2624_ = _e633;
                if _e633 {
                    let _e634: i32 = flags;
                    phi_2624_ = ((_e634 & 4i) != 0i);
                }
                let _e638: bool = phi_2624_;
                if _e638 {
                    let _e639: i32 = i;
                    let _e640: i32 = i;
                    param_109 = _e640;
                    let _e642: f32 = c_7.height;
                    param_110 = _e642;
                    let _e645: vec4<f32> = unnamed.u_layerD[_e639];
                    param_111 = _e645.xy;
                    let _e647: vec4<f32> = cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b((&param_109), (&param_110), (&param_111));
                    local_17 = _e647;
                } else {
                    let _e648: i32 = i;
                    param_112 = _e648;
                    let _e650: f32 = v_7[0u];
                    param_113 = _e650;
                    let _e651: vec4<f32> = cspPalette_u0028_i1_u003b_f1_u003b((&param_112), (&param_113));
                    local_17 = _e651;
                }
                let _e652: vec4<f32> = local_17;
                local_16 = _e652;
            }
            let _e653: vec4<f32> = local_16;
            colour = _e653;
            let _e654: i32 = style_2;
            let _e656: i32 = style_2;
            let _e659: f32 = param_101;
            if (((_e654 == 5i) || (_e656 == 10i)) && (_e659 > 0f)) {
                let _e663: f32 = unnamed.u_ambient;
                let _e665: f32 = unnamed.u_ambient;
                let _e668: f32 = c_7.sdx;
                param_114 = _e668;
                let _e670: f32 = c_7.sdy;
                param_115 = _e670;
                let _e672: f32 = unnamed.u_sunAzimuth;
                param_116 = _e672;
                let _e673: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_114), (&param_115), (&param_116));
                shade = (_e663 + ((1f - _e665) * _e673));
                let _e676: vec4<f32> = colour;
                let _e678: f32 = shade;
                let _e681: f32 = param_101;
                let _e685: vec3<f32> = min((_e676.xyz * mix(1f, (0.33f + (0.82f * _e678)), clamp(_e681, 0f, 1f))), vec3<f32>(1f, 1f, 1f));
                colour[0u] = _e685.x;
                colour[1u] = _e685.y;
                colour[2u] = _e685.z;
            }
            let _e693: f32 = colour[3u];
            let _e695: f32 = v_7[1u];
            let _e698: f32 = layer_5[1u];
            alpha = clamp(((_e693 * _e695) * _e698), 0f, 1f);
            let _e701: f32 = alpha;
            if (_e701 <= 0f) {
                continue;
            }
            let _e704: f32 = layer_5[2u];
            let _e707: vec4<f32> = acc;
            param_117 = _e707;
            let _e708: vec4<f32> = colour;
            param_118 = _e708.xyz;
            let _e710: f32 = alpha;
            param_119 = _e710;
            param_120 = i32((_e704 + 0.5f));
            let _e711: vec4<f32> = cspComposite_u0028_vf4_u003b_vf3_u003b_f1_u003b_i1_u003b((&param_117), (&param_118), (&param_119), (&param_120));
            acc = _e711;
            continue;
        } else {
            break;
        }
        continuing {
            let _e712: i32 = i;
            i = (_e712 + 1i);
        }
    }
    let _e715: f32 = acc[3u];
    if (_e715 <= 0f) {
        return vec4<f32>(0f, 0f, 0f, 0f);
    }
    let _e717: vec4<f32> = acc;
    let _e720: f32 = acc[3u];
    param_121 = (_e717.xyz / vec3(_e720));
    let _e723: vec3<f32> = cspApplyAppearance_u0028_vf3_u003b((&param_121));
    straight_1 = _e723;
    let _e724: vec3<f32> = straight_1;
    let _e726: f32 = acc[3u];
    let _e727: vec3<f32> = (_e724 * _e726);
    let _e729: f32 = acc[3u];
    let _e735: f32 = unnamed.u_terrainOpacity;
    return (vec4<f32>(_e727.x, _e727.y, _e727.z, _e729) * _e735);
}

fn cspSpectrumColour_u0028_f1_u003b(value_6: ptr<function, f32>) -> vec4<f32> {
    var result: vec4<f32>;
    var d_2: f32;
    var t_4: f32;
    var blend: f32;
    var white: vec3<f32>;
    var target_: vec3<f32>;
    var local_18: vec3<f32>;
    var rgb: vec3<f32>;
    var a_3: f32;
    var belowCoverage: f32;
    var local_19: f32;
    var aboveCoverage: f32;
    var local_20: f32;
    var a_4: f32;
    var a_5: f32;
    var line: f32;
    var a_6: f32;

    result = vec4<f32>(0f, 0f, 0f, 0f);
    let _e279: f32 = unnamed.u_spectrumOn;
    if (_e279 > 0.5f) {
        let _e281: f32 = (*value_6);
        let _e283: f32 = unnamed.u_spectrumLevel;
        let _e286: f32 = unnamed.u_spectrumSpan;
        d_2 = ((_e281 - _e283) / max(1f, _e286));
        let _e289: f32 = d_2;
        t_4 = clamp(abs(_e289), 0f, 1f);
        let _e292: f32 = t_4;
        let _e293: f32 = t_4;
        let _e295: f32 = t_4;
        blend = ((_e292 * _e293) * (3f - (2f * _e295)));
        let _e300: vec3<f32> = unnamed.u_spectrumMid;
        white = _e300;
        let _e301: f32 = d_2;
        if (_e301 >= 0f) {
            let _e304: vec3<f32> = unnamed.u_spectrumHigh;
            local_18 = _e304;
        } else {
            let _e306: vec3<f32> = unnamed.u_spectrumLow;
            local_18 = _e306;
        }
        let _e307: vec3<f32> = local_18;
        target_ = _e307;
        let _e308: vec3<f32> = white;
        let _e309: vec3<f32> = target_;
        let _e310: f32 = blend;
        rgb = mix(_e308, _e309, vec3(_e310));
        let _e314: f32 = unnamed.u_spectrumAlpha;
        let _e315: f32 = t_4;
        a_3 = clamp((_e314 * (0.15f + (0.85f * _e315))), 0f, 1f);
        let _e320: vec3<f32> = rgb;
        let _e321: f32 = a_3;
        let _e323: vec4<f32> = result;
        let _e325: f32 = a_3;
        let _e328: vec3<f32> = ((_e320 * _e321) + (_e323.xyz * (1f - _e325)));
        let _e329: f32 = a_3;
        let _e331: f32 = result[3u];
        let _e332: f32 = a_3;
        result = vec4<f32>(_e328.x, _e328.y, _e328.z, (_e329 + (_e331 * (1f - _e332))));
    }
    let _e341: f32 = unnamed.u_bandFeather;
    if (_e341 > 0f) {
        let _e344: f32 = unnamed.u_belowLevel;
        let _e346: f32 = unnamed.u_bandFeather;
        let _e350: f32 = unnamed.u_belowLevel;
        let _e352: f32 = unnamed.u_bandFeather;
        let _e355: f32 = (*value_6);
        local_19 = (1f - smoothstep((_e344 - (_e346 * 0.5f)), (_e350 + (_e352 * 0.5f)), _e355));
    } else {
        let _e358: f32 = (*value_6);
        let _e360: f32 = unnamed.u_belowLevel;
        local_19 = step(_e358, _e360);
    }
    let _e362: f32 = local_19;
    belowCoverage = _e362;
    let _e364: f32 = unnamed.u_bandFeather;
    if (_e364 > 0f) {
        let _e367: f32 = unnamed.u_aboveLevel;
        let _e369: f32 = unnamed.u_bandFeather;
        let _e373: f32 = unnamed.u_aboveLevel;
        let _e375: f32 = unnamed.u_bandFeather;
        let _e378: f32 = (*value_6);
        local_20 = smoothstep((_e367 - (_e369 * 0.5f)), (_e373 + (_e375 * 0.5f)), _e378);
    } else {
        let _e381: f32 = unnamed.u_aboveLevel;
        let _e382: f32 = (*value_6);
        local_20 = step(_e381, _e382);
    }
    let _e384: f32 = local_20;
    aboveCoverage = _e384;
    let _e386: f32 = unnamed.u_belowOn;
    if (_e386 > 0.5f) {
        let _e389: f32 = unnamed.u_bandAlpha;
        let _e390: f32 = belowCoverage;
        a_4 = clamp((_e389 * _e390), 0f, 1f);
        let _e394: vec3<f32> = unnamed.u_belowColor;
        let _e395: f32 = a_4;
        let _e397: vec4<f32> = result;
        let _e399: f32 = a_4;
        let _e402: vec3<f32> = ((_e394 * _e395) + (_e397.xyz * (1f - _e399)));
        let _e403: f32 = a_4;
        let _e405: f32 = result[3u];
        let _e406: f32 = a_4;
        result = vec4<f32>(_e402.x, _e402.y, _e402.z, (_e403 + (_e405 * (1f - _e406))));
    }
    let _e415: f32 = unnamed.u_aboveOn;
    if (_e415 > 0.5f) {
        let _e418: f32 = unnamed.u_bandAlpha;
        let _e419: f32 = aboveCoverage;
        a_5 = clamp((_e418 * _e419), 0f, 1f);
        let _e423: vec3<f32> = unnamed.u_aboveColor;
        let _e424: f32 = a_5;
        let _e426: vec4<f32> = result;
        let _e428: f32 = a_5;
        let _e431: vec3<f32> = ((_e423 * _e424) + (_e426.xyz * (1f - _e428)));
        let _e432: f32 = a_5;
        let _e434: f32 = result[3u];
        let _e435: f32 = a_5;
        result = vec4<f32>(_e431.x, _e431.y, _e431.z, (_e432 + (_e434 * (1f - _e435))));
    }
    let _e444: f32 = unnamed.u_outlineOn;
    if (_e444 > 0.5f) {
        line = 0f;
        let _e447: f32 = unnamed.u_belowOn;
        if (_e447 > 0.5f) {
            let _e449: f32 = line;
            let _e451: f32 = unnamed.u_outlineWidth;
            let _e454: f32 = (*value_6);
            let _e456: f32 = unnamed.u_belowLevel;
            line = max(_e449, (1f - smoothstep(0f, max(0.001f, (_e451 * 0.5f)), abs((_e454 - _e456)))));
        }
        let _e463: f32 = unnamed.u_aboveOn;
        if (_e463 > 0.5f) {
            let _e465: f32 = line;
            let _e467: f32 = unnamed.u_outlineWidth;
            let _e470: f32 = (*value_6);
            let _e472: f32 = unnamed.u_aboveLevel;
            line = max(_e465, (1f - smoothstep(0f, max(0.001f, (_e467 * 0.5f)), abs((_e470 - _e472)))));
        }
        let _e478: f32 = line;
        a_6 = clamp((0.88f * _e478), 0f, 1f);
        let _e481: f32 = a_6;
        let _e483: vec4<f32> = result;
        let _e485: f32 = a_6;
        let _e488: vec3<f32> = ((vec3<f32>(1f, 1f, 1f) * _e481) + (_e483.xyz * (1f - _e485)));
        let _e489: f32 = a_6;
        let _e491: f32 = result[3u];
        let _e492: f32 = a_6;
        result = vec4<f32>(_e488.x, _e488.y, _e488.z, (_e489 + (_e491 * (1f - _e492))));
    }
    let _e500: vec4<f32> = result;
    return _e500;
}

fn main_1() {
    var size: vec2<i32>;
    var p_9: vec2<i32>;
    var param_122: vec2<i32>;
    var value_7: f32;
    var param_123: vec2<i32>;
    var cssOffset: vec2<f32>;
    var cosB_1: f32;
    var sinB_1: f32;
    var worldCss: f32;
    var merc_2: vec2<f32>;
    var lat: f32;
    var mpp: f32;
    var groundRes_1: f32;
    var local_21: f32;
    var spectrum: vec4<f32>;
    var param_124: f32;
    var terrain: vec4<f32>;
    var param_125: vec2<i32>;
    var param_126: f32;
    var param_127: f32;
    var param_128: f32;
    var param_129: f32;
    var param_130: vec2<f32>;
    var px_1: vec2<i32>;
    var py_1: vec2<i32>;
    var allValid: bool;
    var param_131: vec2<i32>;
    var param_132: vec2<i32>;
    var param_133: vec2<i32>;
    var param_134: vec2<i32>;
    var param_135: vec2<i32>;
    var param_136: vec2<i32>;
    var param_137: vec2<i32>;
    var param_138: vec2<i32>;
    var a_7: f32;
    var param_139: vec2<i32>;
    var b_7: f32;
    var param_140: vec2<i32>;
    var c_8: f32;
    var param_141: vec2<i32>;
    var d_3: f32;
    var param_142: vec2<i32>;
    var f_1: f32;
    var param_143: vec2<i32>;
    var g_1: f32;
    var param_144: vec2<i32>;
    var q_3: f32;
    var param_145: vec2<i32>;
    var k_3: f32;
    var param_146: vec2<i32>;
    var shaded: bool;
    var zFactor_1: f32;
    var res: f32;
    var local_22: f32;
    var dxS_1: f32;
    var dyS_1: f32;
    var dx_4: f32;
    var north_1: f32;
    var dy_4: f32;
    var colour_1: vec4<f32>;
    var painted: bool;
    var param_147: f32;
    var param_148: f32;
    var param_149: f32;
    var param_150: f32;
    var northness: f32;
    var param_151: f32;
    var param_152: f32;
    var amount: f32;
    var neutral: vec3<f32>;
    var target_1: vec3<f32>;
    var interval_1: f32;
    var local_23: f32;
    var local_24: f32;
    var perPixel_1: f32;
    var spacing_1: f32;
    var multiple_1: f32;
    var distanceToLine_1: f32;
    var lineWidth_1: f32;
    var indexLine_1: bool;
    var shade_1: f32;
    var param_153: f32;
    var param_154: f32;
    var param_155: f32;
    var param_156: f32;
    var aspect_1: f32;
    var param_157: f32;
    var param_158: f32;
    var sum_1: f32;
    var total_1: f32;
    var index_1: i32;
    var az_2: f32;
    var s_6: f32;
    var weight_1: f32;
    var local_25: f32;
    var param_159: f32;
    var param_160: f32;
    var param_161: f32;
    var direct: f32;
    var shade_2: f32;
    var direct_1: f32;
    var param_162: f32;
    var param_163: f32;
    var param_164: f32;
    var shade_3: f32;
    var straight_2: vec3<f32>;
    var local_26: vec3<f32>;
    var param_165: vec3<f32>;
    var phi_2923_: bool;
    var phi_2933_: bool;
    var phi_2941_: bool;
    var phi_2949_: bool;
    var phi_2959_: bool;
    var phi_2967_: bool;
    var phi_2977_: bool;
    var phi_3047_: bool;
    var phi_3054_: bool;

    let _e368: vec2<i32> = csp_size_u0028_();
    size = _e368;
    let _e369: vec2<f32> = v_screenUv_1;
    let _e370: vec2<i32> = size;
    let _e375: vec2<i32> = size;
    p_9 = clamp(vec2<i32>(floor((_e369 * vec2<f32>(_e370)))), vec2<i32>(0i, 0i), (_e375 - vec2<i32>(1i, 1i)));
    let _e378: vec2<i32> = p_9;
    param_122 = _e378;
    let _e379: bool = csp_valid_u0028_vi2_u003b((&param_122));
    if !(_e379) {
        fragColor = vec4<f32>(0f, 0f, 0f, 0f);
        return;
    }
    let _e381: vec2<i32> = p_9;
    param_123 = _e381;
    let _e382: f32 = csp_height_u0028_vi2_u003b((&param_123));
    value_7 = _e382;
    let _e383: vec2<f32> = v_screenUv_1;
    let _e387: vec2<f32> = unnamed.u_cssSize;
    cssOffset = ((_e383 - vec2(0.5f)) * _e387);
    let _e390: f32 = unnamed.u_bearingRad;
    cosB_1 = cos(_e390);
    let _e393: f32 = unnamed.u_bearingRad;
    sinB_1 = sin(_e393);
    let _e396: f32 = unnamed.u_zoom;
    worldCss = (256f * exp2(_e396));
    let _e400: vec2<f32> = unnamed.u_centerMerc;
    let _e402: f32 = cssOffset[0u];
    let _e403: f32 = cosB_1;
    let _e406: f32 = cssOffset[1u];
    let _e407: f32 = sinB_1;
    let _e411: f32 = cssOffset[0u];
    let _e413: f32 = sinB_1;
    let _e416: f32 = cssOffset[1u];
    let _e417: f32 = cosB_1;
    let _e421: f32 = worldCss;
    merc_2 = (_e400 + (vec2<f32>(((_e402 * _e403) + (_e406 * _e407)), ((-(_e411) * _e413) + (_e416 * _e417))) / vec2(_e421)));
    let _e426: f32 = merc_2[1u];
    lat = atan(sinh((3.1415927f * (1f - (2f * _e426)))));
    let _e432: f32 = lat;
    let _e436: f32 = unnamed.u_zoom;
    let _e440: f32 = unnamed.u_dpr;
    mpp = ((40075016f * cos(_e432)) / ((256f * exp2(_e436)) * _e440));
    let _e444: f32 = unnamed.u_groundResOverride;
    if (_e444 > 0f) {
        let _e447: f32 = unnamed.u_groundResOverride;
        local_21 = _e447;
    } else {
        let _e448: f32 = mpp;
        local_21 = _e448;
    }
    let _e449: f32 = local_21;
    groundRes_1 = _e449;
    let _e450: f32 = value_7;
    param_124 = _e450;
    let _e451: vec4<f32> = cspSpectrumColour_u0028_f1_u003b((&param_124));
    let _e453: f32 = unnamed.u_spectrumOpacity;
    spectrum = (_e451 * _e453);
    terrain = vec4<f32>(0f, 0f, 0f, 0f);
    let _e456: f32 = unnamed.u_stackOn;
    if (_e456 > 0.5f) {
        let _e458: vec2<i32> = p_9;
        param_125 = _e458;
        let _e459: f32 = value_7;
        param_126 = _e459;
        let _e460: f32 = groundRes_1;
        param_127 = _e460;
        let _e461: f32 = cosB_1;
        param_128 = _e461;
        let _e462: f32 = sinB_1;
        param_129 = _e462;
        let _e463: vec2<f32> = merc_2;
        param_130 = _e463;
        let _e464: vec4<f32> = cspStack_u0028_vi2_u003b_f1_u003b_f1_u003b_f1_u003b_f1_u003b_vf2_u003b((&param_125), (&param_126), (&param_127), (&param_128), (&param_129), (&param_130));
        terrain = _e464;
    } else {
        let _e466: i32 = unnamed.u_style;
        if (_e466 >= 0i) {
            px_1 = vec2<i32>(1i, 0i);
            py_1 = vec2<i32>(0i, 1i);
            let _e468: vec2<i32> = p_9;
            let _e469: vec2<i32> = px_1;
            let _e471: vec2<i32> = py_1;
            param_131 = ((_e468 - _e469) - _e471);
            let _e473: bool = csp_valid_u0028_vi2_u003b((&param_131));
            phi_2923_ = _e473;
            if _e473 {
                let _e474: vec2<i32> = p_9;
                let _e475: vec2<i32> = py_1;
                param_132 = (_e474 - _e475);
                let _e477: bool = csp_valid_u0028_vi2_u003b((&param_132));
                phi_2923_ = _e477;
            }
            let _e479: bool = phi_2923_;
            phi_2933_ = _e479;
            if _e479 {
                let _e480: vec2<i32> = p_9;
                let _e481: vec2<i32> = px_1;
                let _e483: vec2<i32> = py_1;
                param_133 = ((_e480 + _e481) - _e483);
                let _e485: bool = csp_valid_u0028_vi2_u003b((&param_133));
                phi_2933_ = _e485;
            }
            let _e487: bool = phi_2933_;
            phi_2941_ = _e487;
            if _e487 {
                let _e488: vec2<i32> = p_9;
                let _e489: vec2<i32> = px_1;
                param_134 = (_e488 - _e489);
                let _e491: bool = csp_valid_u0028_vi2_u003b((&param_134));
                phi_2941_ = _e491;
            }
            let _e493: bool = phi_2941_;
            phi_2949_ = _e493;
            if _e493 {
                let _e494: vec2<i32> = p_9;
                let _e495: vec2<i32> = px_1;
                param_135 = (_e494 + _e495);
                let _e497: bool = csp_valid_u0028_vi2_u003b((&param_135));
                phi_2949_ = _e497;
            }
            let _e499: bool = phi_2949_;
            phi_2959_ = _e499;
            if _e499 {
                let _e500: vec2<i32> = p_9;
                let _e501: vec2<i32> = px_1;
                let _e503: vec2<i32> = py_1;
                param_136 = ((_e500 - _e501) + _e503);
                let _e505: bool = csp_valid_u0028_vi2_u003b((&param_136));
                phi_2959_ = _e505;
            }
            let _e507: bool = phi_2959_;
            phi_2967_ = _e507;
            if _e507 {
                let _e508: vec2<i32> = p_9;
                let _e509: vec2<i32> = py_1;
                param_137 = (_e508 + _e509);
                let _e511: bool = csp_valid_u0028_vi2_u003b((&param_137));
                phi_2967_ = _e511;
            }
            let _e513: bool = phi_2967_;
            phi_2977_ = _e513;
            if _e513 {
                let _e514: vec2<i32> = p_9;
                let _e515: vec2<i32> = px_1;
                let _e517: vec2<i32> = py_1;
                param_138 = ((_e514 + _e515) + _e517);
                let _e519: bool = csp_valid_u0028_vi2_u003b((&param_138));
                phi_2977_ = _e519;
            }
            let _e521: bool = phi_2977_;
            allValid = _e521;
            let _e522: bool = allValid;
            if _e522 {
                let _e523: vec2<i32> = p_9;
                let _e524: vec2<i32> = px_1;
                let _e526: vec2<i32> = py_1;
                param_139 = ((_e523 - _e524) - _e526);
                let _e528: f32 = csp_height_u0028_vi2_u003b((&param_139));
                a_7 = _e528;
                let _e529: vec2<i32> = p_9;
                let _e530: vec2<i32> = py_1;
                param_140 = (_e529 - _e530);
                let _e532: f32 = csp_height_u0028_vi2_u003b((&param_140));
                b_7 = _e532;
                let _e533: vec2<i32> = p_9;
                let _e534: vec2<i32> = px_1;
                let _e536: vec2<i32> = py_1;
                param_141 = ((_e533 + _e534) - _e536);
                let _e538: f32 = csp_height_u0028_vi2_u003b((&param_141));
                c_8 = _e538;
                let _e539: vec2<i32> = p_9;
                let _e540: vec2<i32> = px_1;
                param_142 = (_e539 - _e540);
                let _e542: f32 = csp_height_u0028_vi2_u003b((&param_142));
                d_3 = _e542;
                let _e543: vec2<i32> = p_9;
                let _e544: vec2<i32> = px_1;
                param_143 = (_e543 + _e544);
                let _e546: f32 = csp_height_u0028_vi2_u003b((&param_143));
                f_1 = _e546;
                let _e547: vec2<i32> = p_9;
                let _e548: vec2<i32> = px_1;
                let _e550: vec2<i32> = py_1;
                param_144 = ((_e547 - _e548) + _e550);
                let _e552: f32 = csp_height_u0028_vi2_u003b((&param_144));
                g_1 = _e552;
                let _e553: vec2<i32> = p_9;
                let _e554: vec2<i32> = py_1;
                param_145 = (_e553 + _e554);
                let _e556: f32 = csp_height_u0028_vi2_u003b((&param_145));
                q_3 = _e556;
                let _e557: vec2<i32> = p_9;
                let _e558: vec2<i32> = px_1;
                let _e560: vec2<i32> = py_1;
                param_146 = ((_e557 + _e558) + _e560);
                let _e562: f32 = csp_height_u0028_vi2_u003b((&param_146));
                k_3 = _e562;
                let _e564: i32 = unnamed.u_style;
                let _e565: bool = (_e564 == 0i);
                phi_3047_ = _e565;
                if !(_e565) {
                    let _e568: i32 = unnamed.u_style;
                    phi_3047_ = (_e568 == 1i);
                }
                let _e571: bool = phi_3047_;
                phi_3054_ = _e571;
                if !(_e571) {
                    let _e574: i32 = unnamed.u_style;
                    phi_3054_ = (_e574 == 5i);
                }
                let _e577: bool = phi_3054_;
                shaded = _e577;
                let _e578: f32 = groundRes_1;
                zFactor_1 = (1f + (0.024f * pow(max(_e578, 0f), 0.664f)));
                let _e583: bool = shaded;
                if _e583 {
                    let _e584: f32 = groundRes_1;
                    let _e585: f32 = zFactor_1;
                    local_22 = (_e584 / _e585);
                } else {
                    let _e587: f32 = groundRes_1;
                    local_22 = _e587;
                }
                let _e588: f32 = local_22;
                res = _e588;
                let _e589: f32 = c_8;
                let _e590: f32 = f_1;
                let _e593: f32 = k_3;
                let _e595: f32 = a_7;
                let _e596: f32 = d_3;
                let _e599: f32 = g_1;
                let _e602: f32 = res;
                dxS_1 = ((((_e589 + (2f * _e590)) + _e593) - ((_e595 + (2f * _e596)) + _e599)) / (8f * _e602));
                let _e605: f32 = g_1;
                let _e606: f32 = q_3;
                let _e609: f32 = k_3;
                let _e611: f32 = a_7;
                let _e612: f32 = b_7;
                let _e615: f32 = c_8;
                let _e618: f32 = res;
                dyS_1 = ((((_e605 + (2f * _e606)) + _e609) - ((_e611 + (2f * _e612)) + _e615)) / (8f * _e618));
                let _e621: f32 = dxS_1;
                let _e622: f32 = cosB_1;
                let _e624: f32 = dyS_1;
                let _e625: f32 = sinB_1;
                dx_4 = ((_e621 * _e622) + (_e624 * _e625));
                let _e628: f32 = dxS_1;
                let _e629: f32 = sinB_1;
                let _e631: f32 = dyS_1;
                let _e632: f32 = cosB_1;
                north_1 = ((_e628 * _e629) - (_e631 * _e632));
                let _e635: f32 = north_1;
                dy_4 = -(_e635);
                colour_1 = vec4<f32>(0f, 0f, 0f, 0f);
                painted = true;
                let _e638: i32 = unnamed.u_style;
                if (_e638 == 2i) {
                    let _e640: f32 = dx_4;
                    let _e641: f32 = dy_4;
                    param_147 = degrees(atan(length(vec2<f32>(_e640, _e641))));
                    let _e646: vec3<f32> = cspSlopeColour_u0028_f1_u003b((&param_147));
                    colour_1 = vec4<f32>(_e646.x, _e646.y, _e646.z, 1f);
                } else {
                    let _e652: i32 = unnamed.u_style;
                    if (_e652 == 3i) {
                        let _e654: f32 = dx_4;
                        let _e655: f32 = dy_4;
                        if (length(vec2<f32>(_e654, _e655)) <= 0.008726868f) {
                            painted = false;
                        } else {
                            let _e659: f32 = dx_4;
                            param_148 = _e659;
                            let _e660: f32 = dy_4;
                            param_149 = _e660;
                            let _e661: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_148), (&param_149));
                            param_150 = _e661;
                            let _e662: vec3<f32> = cspAspectColour_u0028_f1_u003b((&param_150));
                            colour_1 = vec4<f32>(_e662.x, _e662.y, _e662.z, 1f);
                        }
                    } else {
                        let _e668: i32 = unnamed.u_style;
                        if (_e668 == 4i) {
                            let _e670: f32 = dx_4;
                            let _e671: f32 = dy_4;
                            if (length(vec2<f32>(_e670, _e671)) <= 0.008726868f) {
                                painted = false;
                            } else {
                                let _e675: f32 = dx_4;
                                param_151 = _e675;
                                let _e676: f32 = dy_4;
                                param_152 = _e676;
                                let _e677: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_151), (&param_152));
                                northness = cos(radians(_e677));
                                let _e680: f32 = northness;
                                amount = abs(_e680);
                                neutral = vec3<f32>(0.96862745f, 0.9529412f, 0.8784314f);
                                let _e682: f32 = northness;
                                target_1 = (select(vec3<f32>(214f, 82f, 78f), vec3<f32>(55f, 137f, 92f), vec3((_e682 >= 0f))) / vec3(255f));
                                let _e688: vec3<f32> = neutral;
                                let _e689: vec3<f32> = target_1;
                                let _e690: f32 = amount;
                                let _e692: vec3<f32> = mix(_e688, _e689, vec3(_e690));
                                colour_1 = vec4<f32>(_e692.x, _e692.y, _e692.z, 1f);
                            }
                        } else {
                            let _e698: i32 = unnamed.u_style;
                            if (_e698 >= 6i) {
                                let _e701: i32 = unnamed.u_style;
                                if (_e701 == 6i) {
                                    local_23 = 2f;
                                } else {
                                    let _e704: i32 = unnamed.u_style;
                                    if (_e704 == 7i) {
                                        local_24 = 5f;
                                    } else {
                                        let _e707: i32 = unnamed.u_style;
                                        local_24 = select(25f, 10f, (_e707 == 8i));
                                    }
                                    let _e710: f32 = local_24;
                                    local_23 = _e710;
                                }
                                let _e711: f32 = local_23;
                                interval_1 = _e711;
                                let _e712: f32 = dx_4;
                                let _e713: f32 = dy_4;
                                let _e716: f32 = res;
                                perPixel_1 = ((length(vec2<f32>(_e712, _e713)) * _e716) * 3.28084f);
                                let _e719: f32 = perPixel_1;
                                if (_e719 > 0f) {
                                    let _e721: f32 = interval_1;
                                    let _e722: f32 = perPixel_1;
                                    spacing_1 = (_e721 / _e722);
                                    let _e724: f32 = spacing_1;
                                    if (_e724 < 3f) {
                                        let _e726: f32 = spacing_1;
                                        if ((_e726 * 5f) >= 3f) {
                                            let _e729: f32 = interval_1;
                                            interval_1 = (_e729 * 5f);
                                        } else {
                                            painted = false;
                                        }
                                    }
                                }
                                let _e731: bool = painted;
                                if _e731 {
                                    let _e732: f32 = value_7;
                                    let _e734: f32 = interval_1;
                                    multiple_1 = ((_e732 * 3.28084f) / _e734);
                                    let _e736: f32 = multiple_1;
                                    let _e737: f32 = multiple_1;
                                    let _e741: f32 = interval_1;
                                    distanceToLine_1 = (abs((_e736 - round(_e737))) * _e741);
                                    let _e743: f32 = interval_1;
                                    let _e745: f32 = perPixel_1;
                                    lineWidth_1 = max(0.35f, min((_e743 * 0.5f), (_e745 * 0.7f)));
                                    let _e749: f32 = distanceToLine_1;
                                    let _e750: f32 = lineWidth_1;
                                    if (_e749 >= _e750) {
                                        painted = false;
                                    } else {
                                        let _e752: f32 = multiple_1;
                                        let _e753: f32 = round(_e752);
                                        indexLine_1 = (abs((_e753 - (floor((_e753 / 5f)) * 5f))) < 0.5f);
                                        let _e760: bool = indexLine_1;
                                        colour_1 = select(vec4<f32>(0.5882353f, 0.43137255f, 0.3137255f, 0.78431374f), vec4<f32>(0.47058824f, 0.27450982f, 0.15686275f, 1f), vec4(_e760));
                                    }
                                }
                            } else {
                                let _e764: i32 = unnamed.u_style;
                                if (_e764 == 5i) {
                                    let _e767: f32 = unnamed.u_ambient;
                                    let _e769: f32 = unnamed.u_ambient;
                                    let _e771: f32 = dx_4;
                                    param_153 = _e771;
                                    let _e772: f32 = dy_4;
                                    param_154 = _e772;
                                    let _e774: f32 = unnamed.u_sunAzimuth;
                                    param_155 = _e774;
                                    let _e775: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_153), (&param_154), (&param_155));
                                    shade_1 = (_e767 + ((1f - _e769) * _e775));
                                    let _e778: f32 = value_7;
                                    param_156 = _e778;
                                    let _e779: vec3<f32> = cspTintColour_u0028_f1_u003b((&param_156));
                                    let _e780: f32 = shade_1;
                                    let _e784: vec3<f32> = min((_e779 * (0.33f + (0.82f * _e780))), vec3<f32>(1f, 1f, 1f));
                                    colour_1 = vec4<f32>(_e784.x, _e784.y, _e784.z, 1f);
                                } else {
                                    let _e790: i32 = unnamed.u_style;
                                    if (_e790 == 1i) {
                                        let _e792: f32 = dx_4;
                                        param_157 = _e792;
                                        let _e793: f32 = dy_4;
                                        param_158 = _e793;
                                        let _e794: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_157), (&param_158));
                                        aspect_1 = _e794;
                                        sum_1 = 0f;
                                        total_1 = 0f;
                                        index_1 = 0i;
                                        loop {
                                            let _e795: i32 = index_1;
                                            if (_e795 < 4i) {
                                                let _e798: f32 = unnamed.u_sunAzimuth;
                                                let _e800: i32 = index_1;
                                                az_2 = ((_e798 - 90f) + (45f * f32(_e800)));
                                                let _e804: f32 = aspect_1;
                                                let _e805: f32 = az_2;
                                                s_6 = sin(radians((_e804 - (_e805 - (floor((_e805 / 360f)) * 360f)))));
                                                let _e813: f32 = dx_4;
                                                let _e814: f32 = dy_4;
                                                if (length(vec2<f32>(_e813, _e814)) < 0.000000000001f) {
                                                    local_25 = 1f;
                                                } else {
                                                    let _e818: f32 = s_6;
                                                    let _e819: f32 = s_6;
                                                    local_25 = (_e818 * _e819);
                                                }
                                                let _e821: f32 = local_25;
                                                weight_1 = _e821;
                                                let _e822: f32 = weight_1;
                                                let _e823: f32 = dx_4;
                                                param_159 = _e823;
                                                let _e824: f32 = dy_4;
                                                param_160 = _e824;
                                                let _e825: f32 = az_2;
                                                param_161 = _e825;
                                                let _e826: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_159), (&param_160), (&param_161));
                                                let _e828: f32 = sum_1;
                                                sum_1 = (_e828 + (_e822 * _e826));
                                                let _e830: f32 = weight_1;
                                                let _e831: f32 = total_1;
                                                total_1 = (_e831 + _e830);
                                                continue;
                                            } else {
                                                break;
                                            }
                                            continuing {
                                                let _e833: i32 = index_1;
                                                index_1 = (_e833 + 1i);
                                            }
                                        }
                                        let _e835: f32 = sum_1;
                                        let _e836: f32 = total_1;
                                        direct = (_e835 / max(_e836, 0.00001f));
                                        let _e840: f32 = unnamed.u_ambient;
                                        let _e842: f32 = unnamed.u_ambient;
                                        let _e844: f32 = direct;
                                        shade_2 = (_e840 + ((1f - _e842) * _e844));
                                        let _e847: f32 = shade_2;
                                        let _e848: vec3<f32> = vec3(_e847);
                                        colour_1 = vec4<f32>(_e848.x, _e848.y, _e848.z, 1f);
                                    } else {
                                        let _e853: f32 = dx_4;
                                        param_162 = _e853;
                                        let _e854: f32 = dy_4;
                                        param_163 = _e854;
                                        let _e856: f32 = unnamed.u_sunAzimuth;
                                        param_164 = _e856;
                                        let _e857: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_162), (&param_163), (&param_164));
                                        direct_1 = _e857;
                                        let _e859: f32 = unnamed.u_ambient;
                                        let _e861: f32 = unnamed.u_ambient;
                                        let _e863: f32 = direct_1;
                                        shade_3 = (_e859 + ((1f - _e861) * _e863));
                                        let _e866: f32 = shade_3;
                                        let _e867: vec3<f32> = vec3(_e866);
                                        colour_1 = vec4<f32>(_e867.x, _e867.y, _e867.z, 1f);
                                    }
                                }
                            }
                        }
                    }
                }
                let _e872: bool = painted;
                if _e872 {
                    let _e874: f32 = colour_1[3u];
                    if (_e874 > 0f) {
                        let _e876: vec4<f32> = colour_1;
                        param_165 = _e876.xyz;
                        let _e878: vec3<f32> = cspApplyAppearance_u0028_vf3_u003b((&param_165));
                        local_26 = _e878;
                    } else {
                        local_26 = vec3<f32>(0f, 0f, 0f);
                    }
                    let _e879: vec3<f32> = local_26;
                    straight_2 = _e879;
                    let _e880: vec3<f32> = straight_2;
                    let _e882: f32 = colour_1[3u];
                    let _e883: vec3<f32> = (_e880 * _e882);
                    let _e885: f32 = colour_1[3u];
                    let _e891: f32 = unnamed.u_terrainOpacity;
                    terrain = (vec4<f32>(_e883.x, _e883.y, _e883.z, _e885) * _e891);
                }
            }
        }
    }
    let _e893: vec4<f32> = spectrum;
    let _e894: vec4<f32> = terrain;
    let _e896: f32 = spectrum[3u];
    fragColor = (_e893 + (_e894 * (1f - _e896)));
    return;
}

@fragment 
fn main(@location(0) v_screenUv: vec2<f32>) -> @location(0) vec4<f32> {
    v_screenUv_1 = v_screenUv;
    main_1();
    let _e3: vec4<f32> = fragColor;
    return _e3;
}
