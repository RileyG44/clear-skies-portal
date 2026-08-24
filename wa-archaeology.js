/* Public-safe Washington archaeology research index.
 *
 * This is deliberately not a dump of Washington's protected site inventory.
 * DAHP reports more than 33,000 recorded sites and keeps archaeological-site
 * records behind Secure WISAARD.  Entries below are places already described
 * in public agency or academic sources.  `public-site` markers identify a
 * visitor facility or publicly mapped landscape; `generalized` markers are
 * intentionally displaced to a city, park, river reach, or broad landscape;
 * `estimated` markers are research waypoints inferred from the cited public
 * description and must never be treated as survey coordinates.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  else root.CSPWaArchaeology=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const SOURCES=Object.freeze({
    dahp:{title:"DAHP — Archaeology in Washington",url:"https://dahp.wa.gov/archaeology"},
    dahpField:{title:"DAHP — A Field Guide to Washington State Archaeology",url:"https://dahp.wa.gov/sites/default/files/Field%20Guide%20to%20WA%20Arch_0.pdf"},
    uwBook:{title:"UW Press — Archaeology in Washington",url:"https://uwapress.uw.edu/book/9780295986975/archaeology-in-washington/"},
    moses1952:{title:"Daugherty (1952) — Archaeological Investigations in O'Sullivan Reservoir",url:"https://www.cambridge.org/core/journals/american-antiquity/article/abs/archaeological-investigations-in-osullivan-reservoir-grant-county-washington/E146E370DC556D2D1AF732F147A24CC1"},
    mosesPipes:{title:"American Antiquity — Ancient Northwestern smoking and plant use",url:"https://doi.org/10.1017/aaq.2021.39"},
    mosesShore:{title:"City of Moses Lake — Shoreline Inventory and Characterization",url:"https://cityofml.com/DocumentCenter/View/2492/Shoreline-Inventory-and-Characterization?bidId="},
    wsuPartners:{title:"WSU Museum of Anthropology — Partner-agency collections",url:"https://archaeology.wsu.edu/our-partner-agencies/"},
    marmes:{title:"WSU Press — Marmes Rockshelter",url:"https://wsupress.wsu.edu/product/marmes-rockshelter/"},
    wsuWindust:{title:"WSU — Windust, Granite Point, and Lower Snake collections",url:"https://news.wsu.edu/news/1997/08/12/wsu-records-contemporaries-of-kennewick-man/"},
    manis:{title:"National Register — Manis Mastodon Site (address restricted)",url:"https://npgallery.nps.gov/AssetDetail/NRIS/78002736"},
    olympic:{title:"NPS — Prehistoric Inhabitants of the Olympic Peninsula",url:"https://www.nps.gov/olym/learn/historyculture/prehistoric-inhabitants.htm"},
    ozette:{title:"NPS — Visiting Ozette",url:"https://www.nps.gov/olym/planyourvisit/visiting-ozette.htm"},
    tsewhitzen:{title:"Washington JLARC — Tse-whit-zen review",url:"https://leg.wa.gov/jlarc/AuditAndStudyReports/Documents/06-8.pdf"},
    westPoint:{title:"WSDOT — Historic, cultural, and archaeological resources",url:"https://data.wsdot.wa.gov/publications/Viaduct/AWVFEIS-AppendixI.pdf"},
    bearCreek:{title:"DAHP — Bear Creek Site research",url:"https://dahp.wa.gov/news-and-events/blog/archaeology-first-thursdays-at-psu"},
    cathlapotle:{title:"NPS — Cathlapotle Plankhouse",url:"https://www.nps.gov/places/cathlapotle-plankhouse.htm"},
    fortVancouver:{title:"NPS — Fort Vancouver",url:"https://www.nps.gov/places/fortvancouver.htm"},
    fortVillage:{title:"NPS — Archaeology in the Fort Vancouver Village",url:"https://home.nps.gov/articles/fortvancouvervillage.htm"},
    englishCamp:{title:"NPS — English Camp",url:"https://www.nps.gov/sajh/planyourvisit/english-camp.htm"},
    americanCamp:{title:"NPS — American Camp cultural landscape",url:"https://www.nps.gov/sajh/learn/management/upload/American-Camp-CLI-2004.pdf"},
    buffaloEddy:{title:"NPS — Visit Buffalo Eddy",url:"https://www.nps.gov/nepe/planyourvisit/visit-buffalo-eddy.htm"},
    columbiaHills:{title:"Washington State Parks — Columbia Hills history",url:"https://parks.wa.gov/about/news-center/field-guide-blog/columbia-hills-historical-state-park-history"},
    columbiaHillsVisit:{title:"Washington State Parks — Columbia Hills",url:"https://parks.wa.gov/find-parks/state-parks/columbia-hills-historical-state-park"},
    lenore:{title:"Washington State Parks — Lake Lenore Caves history",url:"https://parks.wa.gov/about/news-center/field-guide-blog/lake-lenore-caves-state-park-heritage-site-history"},
    simcoe:{title:"Washington State Parks — Fort Simcoe",url:"https://parks.wa.gov/find-parks/state-parks/fort-simcoe-historical-state-park"},
    whitman:{title:"NPS — Whitman Mission first-house archaeology",url:"https://www.nps.gov/places/first-house.htm"},
    parksHistoric:{title:"Washington State Parks — Historic preservation",url:"https://parks.wa.gov/about/strategic-planning-projects-public-input/historic-preservation"},
    kennewick:{title:"NPS — Kennewick Man / The Ancient One",url:"https://www.nps.gov/archeology/kennewick/"},
    blake:{title:"Washington State Parks — Blake Island history",url:"https://parks.wa.gov/about/news-center/field-guide-blog/blake-island-marine-state-park-history"},
    cama:{title:"Washington State Parks — Cama Beach cultural-resource record",url:"https://parks.wa.gov/sites/default/files/2024-09/Item%20E-2%20Cama%20Beach%20State%20Park-RA.pdf"},
    fortResearch:{title:"NPS — Fort Vancouver research collections",url:"https://www.nps.gov/fova/learn/historyculture/research.htm"}
  });

  function item(id,name,lon,lat,siteType,period,precision,uncertaintyMi,access,summary,sourceIds,extra){
    return Object.freeze({id,name,coordinates:Object.freeze([lon,lat]),siteType,period,precision,
      uncertaintyMi,access,summary,sourceIds:Object.freeze(sourceIds.slice()),...(extra||{})});
  }

  const SITES=Object.freeze([
    item("ridge-bottom-45gr27","Ridge Bottom Village (45GR27)",-119.322,47.115,"Village / house-pit complex","Late Holocene; features span multiple occupations","generalized",6,"No site-access guidance; marker is the Moses Lake basin, not the site.","Public research describes 33 circular depressions interpreted as house pits and excavations associated with roasting and pipe-use evidence.",["moses1952","mosesPipes"],{region:"Moses Lake",tribalContext:"Moses-Columbia / Columbia Plateau"}),
    item("moses-village-45gr30","Moses Lake village site (45GR30)",-119.300,47.135,"Village / house-pit complex","Pre-contact","estimated",7,"Research waypoint only; do not use for site navigation.","Daugherty reports a second village approximately one mile north of 45GR27. This marker is intentionally broad because the publication text does not provide a survey coordinate.",["moses1952","mosesShore"],{region:"Moses Lake",tribalContext:"Moses-Columbia / Columbia Plateau"}),
    item("mae-valley-westshore","Mae Valley / west-shore cultural-landscape lead",-119.357,47.159,"Research lead / shoreline-use landscape","Undetermined","estimated",4,"Not a verified archaeological-site marker. Use as a literature and field-record search area only.","A research waypoint for the west-shore question supplied for this project. The public shoreline record establishes the basin's cultural-resource sensitivity, but this point does not assert an archaeological site at the golf course or any parcel.",["mosesShore","dahp"],{region:"Moses Lake",tribalContext:"Moses-Columbia / Wanapum regional context",researchLead:true}),
    item("lind-coulee-45gr97","Lind Coulee (45GR97)",-119.100,46.970,"Early occupation / bison-processing camp","About 10,000 years ago","generalized",8,"Protected research site; marker represents the Warden–Lind Coulee landscape.","An early occupation with butchered bison remains, tools, personal objects, and bone needles; curated under the Bureau of Reclamation.",["dahpField","wsuPartners"],{region:"Grant County"}),
    item("east-wenatchee-clovis","East Wenatchee Clovis cache",-120.270,47.420,"Clovis cache","Late Pleistocene","generalized",4,"Private/restricted context; marker is East Wenatchee, not the discovery location.","A cache of translucent chalcedony and jasper Clovis points and tools discovered during irrigation work; DAHP describes 57 finished artifacts in the principal feature.",["dahpField","uwBook"],{region:"East Wenatchee"}),
    item("sentinel-gap","Sentinel Gap archaeological landscape",-119.965,46.835,"Early occupation / Columbia River corridor","Late Pleistocene–Holocene","generalized",6,"Broad landscape marker; cliffs, islands, and private lands may be closed or sensitive.","A repeatedly occupied Columbia River corridor represented in Washington's statewide archaeological synthesis; shown at landscape scale only.",["uwBook","dahpField"],{region:"Kittitas–Grant County boundary"}),
    item("marmes-45fr50","Marmes Rockshelter (45FR50)",-118.445,46.600,"Rockshelter and floodplain occupation","About 11,000 years of use","generalized",3,"Submerged/protected; marker represents the Palouse–Snake confluence landscape.","One of the Pacific Northwest's most significant archaeological records, including early-Holocene occupation; the site was inundated after Lower Monumental Dam.",["marmes","wsuPartners"],{region:"Lyons Ferry / Palouse–Snake confluence"}),
    item("palus-village","Palus village at the Palouse–Snake confluence",-118.432,46.591,"Village","Pre-contact and historic","generalized",3,"Protected river-confluence landscape; no exact site access is implied.","A substantial village investigated during Lower Snake reservoir archaeology; displayed separately from the older rockshelter occupation.",["marmes","uwBook"],{region:"Lyons Ferry"}),
    item("windust-caves","Windust Caves complex",-118.690,46.450,"Cave / rockshelter complex","About 9,000 years ago and later","generalized",18,"Protected Lower Snake River context; marker is intentionally regional.","Lower Snake River cave assemblages helped define the Windust Phase and preserve evidence of exchange between interior and coastal peoples.",["wsuWindust","uwBook"],{region:"Lower Snake River"}),
    item("granite-point-45wt41","Granite Point (45WT41)",-117.180,46.420,"Open occupation / camp","Early Holocene and later","generalized",8,"Protected research site; marker represents the lower Snake River below Clarkston.","A major lower Snake River collection used with Marmes and Windust materials to define early Plateau cultural sequences.",["wsuPartners","wsuWindust"],{region:"Whitman County / lower Snake River"}),
    item("squirt-cave-45ww25","Squirt Cave (45WW25)",-118.780,46.430,"Cave / rockshelter","Holocene","generalized",20,"Protected Lower Snake River research context; not a navigation coordinate.","A curated cave assemblage notable for exceptionally preserved organic technology, including cordage and a wood-handled stone knife.",["wsuPartners","wsuWindust"],{region:"Lower Snake River"}),
    item("ozette-village","Ozette village archaeological landscape",-124.672,48.168,"Wet site / coastal village","Long occupation; mudslide preservation in the early 1700s","generalized",2,"The archaeological site is not a casual visitor destination; use established park and tribal facilities.","Waterlogged houses and thousands of organic artifacts provide an exceptional record of Makah life before sustained European contact.",["olympic","ozette"],{region:"Cape Alava / Makah homeland",tribalContext:"Makah"}),
    item("hoko-river","Hoko River archaeological complex",-124.598,48.329,"Wet site / fishing camp and village landscape","Approximately 2,500 years and earlier regional use","generalized",5,"Broad river-mouth marker; cultural sites and private/tribal lands may be closed.","A coastal archaeological complex known for waterlogged fishing technology and long-term use of the Strait of Juan de Fuca shore.",["uwBook","olympic"],{region:"Hoko River",tribalContext:"Makah / north Olympic coast"}),
    item("manis-mastodon","Manis Mastodon Site",-123.105,48.078,"Late-Pleistocene kill/butchery evidence","Late Pleistocene","generalized",5,"National Register address is restricted; marker is the city of Sequim only.","A mastodon with an embedded bone projectile provides evidence of very early human occupation on the Olympic Peninsula.",["manis","olympic"],{region:"Sequim"}),
    item("tse-whit-zen","Tse-whit-zen village",-123.430,48.120,"Ancestral village and cemetery","Long pre-contact occupation","generalized",1.5,"Culturally sensitive Lower Elwha Klallam site; marker is the Port Angeles waterfront district.","A major ancestral village encountered during the Port Angeles graving-dock project; the state review documents the discovery and subsequent protection response.",["tsewhitzen"],{region:"Port Angeles waterfront",tribalContext:"Lower Elwha Klallam"}),
    item("west-point","West Point Site Complex",-122.435,47.662,"Coastal camp / shell midden complex","At least 4,500 years","generalized",1.5,"Marker identifies the public Discovery Park landform, not subsurface deposits.","A long record of hunter-fisher-gatherer use that also preserves landscape change associated with the Seattle Fault earthquake.",["westPoint"],{region:"Discovery Park, Seattle"}),
    item("bear-creek-45ki839","Bear Creek Site (45KI839)",-122.120,47.673,"Late-Pleistocene–Holocene transition occupation","Late Pleistocene–early Holocene","generalized",2,"Marker is downtown Redmond / Bear Creek, not the protected site boundary.","The first excavated Puget Lowland site of its age to yield lithic artifacts, providing rare evidence for very early settlement and technology.",["bearCreek"],{region:"Redmond"}),
    item("cathlapotle","Cathlapotle village and plankhouse",-122.750,45.820,"Chinookan town / archaeological research landscape","Pre-contact through early 1800s","public-site",0.3,"Use refuge guidance; the plankhouse may be closed except for scheduled programs.","A large Chinookan town documented through more than a decade of archaeology; the modern plankhouse supports tribal life and interpretation.",["cathlapotle","fortResearch"],{region:"Ridgefield National Wildlife Refuge",tribalContext:"Cathlapotle / Chinookan peoples"}),
    item("fort-vancouver","Fort Vancouver archaeological footprint",-122.661,45.626,"Historic fort / fur-trade archaeology","1820s–1860s","public-site",0.2,"Public National Park Service visitor site.","The reconstructed stockade stands on the archaeological footprint identified beginning with NPS excavations in 1947.",["fortVancouver"],{region:"Vancouver"}),
    item("kanaka-village","Fort Vancouver Village / Kanaka Village",-122.666,45.620,"Multicultural worker village","1820s–1860s","public-site",0.4,"Public NPS landscape; follow signed paths and resource-protection rules.","Archaeology documents homes, wells, refuse deposits, clothing, footwear, and food from the diverse community outside the fort stockade.",["fortVillage"],{region:"Vancouver"}),
    item("english-camp","English Camp and Coast Salish village landscape",-123.146,48.586,"Shell midden, longhouse, and military archaeology","Time immemorial; 1860–1872 military occupation","public-site",0.4,"Public NPS site; archaeological deposits remain protected.","The Royal Marines built on a deep shell midden and dismantled a very large Coast Salish longhouse; later archaeology also documents the military camp.",["englishCamp"],{region:"Garrison Bay, San Juan Island",tribalContext:"Coast Salish"}),
    item("american-camp","American Camp archaeological landscape",-123.005,48.462,"Seasonal village, shell midden, military and settlement archaeology","Pre-contact; 1850s–1870s and later","public-site",1,"Public NPS site; remain on established routes around protected resources.","Archaeological sites include a seasonal fishing-village shell midden and features from the American military camp, Belle Vue Sheep Farm, and San Juan Village.",["americanCamp"],{region:"San Juan Island"}),
    item("buffalo-eddy","Buffalo Eddy rock-art site",-116.930414,46.172306,"Petroglyph and pictograph landscape","Possibly 4,500 years and later","public-site",0.1,"Public interpretive trail; do not touch, chalk, trace, or climb on rock art.","Hundreds of Nez Perce images occur on both sides of a Snake River eddy; this marker is the official NPS visitor location.",["buffaloEddy"],{region:"Snake River south of Asotin",tribalContext:"Nimiipuu / Nez Perce"}),
    item("columbia-hills-rock-art","Columbia Hills / Temani Pesh-Wa rock-art landscape",-121.065,45.642,"Petroglyph and pictograph landscape","Long Indigenous use","public-site",0.8,"Use only public displays and reservation-based guided access; many images are sacred and protected.","The park contains some of Washington's most significant Indigenous rock images, including relocated panels in a public display and a restricted guided area.",["columbiaHills","columbiaHillsVisit"],{region:"Columbia Hills Historical State Park",tribalContext:"Yakama and Columbia River peoples"}),
    item("lake-lenore-caves","Lake Lenore Caves rockshelters",-119.518,47.502,"Rockshelters / seasonal-use archaeology","Pre-contact","public-site",0.7,"Public state-park trail; collecting or disturbing artifacts is illegal.","Grand Coulee surveys documented seasonal use, pictographs, cordage, basketry, mats, and chipped-stone tools; the park was developed for public interpretation and protection.",["lenore"],{region:"Grand Coulee"}),
    item("fort-simcoe","Fort Simcoe and earlier Yakama camping landscape",-120.831,46.343,"Historic fort and Indigenous cultural landscape","Pre-contact use; fort from 1856","public-site",0.3,"Public state park on Yakama Nation lands; observe seasonal hours and local guidance.","The fort was built within an established Yakama camping area and preserves one of the West's few pre-Civil War military complexes.",["simcoe"],{region:"White Swan",tribalContext:"Yakama"}),
    item("whitman-mission","Whitman Mission archaeological landscape",-118.462,46.041,"Mission and contact-period archaeology","1836–1847","public-site",0.4,"Public NPS visitor site; the story includes the continuing homeland of the Cayuse people.","Excavated building foundations and landscape features help interpret the mission and its collision with weyíiletpuu lifeways.",["whitman"],{region:"Walla Walla",tribalContext:"Cayuse / Confederated Tribes of the Umatilla Indian Reservation"}),
    item("fort-nisqually","Fort Nisqually archaeological landscape",-122.570,47.304,"Fur-trade and agricultural outpost archaeology","1833–1869","public-site",0.5,"Public museum at Point Defiance; original fort landscape is represented through interpretation.","A Hudson's Bay Company outpost and farm represented in Washington's public historic-site network; archaeological and documentary research informs its interpretation.",["parksHistoric"],{region:"Tacoma / Point Defiance"}),
    item("fort-okanogan","Fort Okanogan archaeological landscape",-119.596,48.101,"Fur-trade post archaeology","1811–1860","public-site",0.8,"Public interpretive landscape; verify current access before travel.","The first enduring American post in present-day Washington and a major Columbia–Okanogan confluence contact-period landscape.",["parksHistoric"],{region:"Brewster / Okanogan–Columbia confluence"}),
    item("spokane-house","Spokane House archaeological landscape",-117.543,47.897,"Fur-trade post and Indigenous landscape","1810–1826 and earlier use","public-site",0.7,"Public state-park heritage site; archaeological resources remain protected.","An early inland fur-trade post at the Spokane–Little Spokane confluence, embedded in a much older Indigenous cultural landscape.",["parksHistoric"],{region:"Riverside State Park",tribalContext:"Spokane"}),
    item("kennewick-ancient-one","Ancient One discovery landscape",-119.120,46.218,"Early human remains discovery / Columbia River landscape","More than 8,000 years ago","generalized",2,"Culturally sensitive and repatriated; marker is Columbia Park, not a discovery coordinate.","A highly consequential discovery whose study, litigation, tribal consultation, and repatriation reshaped public discussion of archaeology and Indigenous sovereignty.",["kennewick","uwBook"],{region:"Kennewick / Columbia River",tribalContext:"The Ancient One"}),
    item("old-man-house","Old Man House village landscape",-122.551,47.733,"Suquamish winter village / longhouse landscape","Time immemorial through the historic period","public-site",0.5,"Public park and living tribal homeland; treat the landscape with respect.","A major Suquamish village and longhouse landscape on Agate Passage, represented here by the public park rather than subsurface site limits.",["blake"],{region:"Suquamish",tribalContext:"Suquamish"}),
    item("cama-beach","Cama Beach Indigenous and resort landscape",-122.510,48.145,"Coast Salish village landscape and historic resort archaeology","Pre-contact through 20th century","public-site",0.8,"Public state park; sensitive areas and human remains are protected.","A layered Camano Island cultural landscape whose tribal significance and archaeological resources are explicitly recognized in park planning.",["cama"],{region:"Camano Island",tribalContext:"Coast Salish"}),
    item("blake-island","Blake Island / Point Tatugh cultural landscape",-122.484,47.536,"Island-use and village landscape","Time immemorial through historic period","public-site",1.5,"Public marine state park; marker is a broad island landscape.","An important Indigenous place within the usual and accustomed area of regional tribes, interpreted here at island scale rather than as an archaeological-site boundary.",["blake"],{region:"Central Puget Sound",tribalContext:"Suquamish and other Coast Salish peoples"}),
    item("kettle-falls","Kettle Falls fishery and village landscape",-118.116,48.613,"Fishery, village, and contact-period landscape","Long pre-contact use through inundation","generalized",3,"Much of the original landscape was inundated; marker is a public Lake Roosevelt vicinity.","A major Upper Columbia salmon fishery and gathering place represented at broad landscape scale because dam construction transformed and submerged the original setting.",["uwBook","dahpField"],{region:"Lake Roosevelt / Upper Columbia"})
  ]);

  const PRECISION_LABELS=Object.freeze({
    "public-site":"Public visitor location",
    generalized:"Generalized for stewardship",
    estimated:"Estimated research waypoint"
  });

  function sourceList(ids){ return ids.map(id=>SOURCES[id]).filter(Boolean) }
  function feature(site){
    const p={...site};delete p.coordinates;delete p.sourceIds;
    p.precisionLabel=PRECISION_LABELS[site.precision]||site.precision;
    p.sources=sourceList(site.sourceIds);
    return {type:"Feature",id:site.id,geometry:{type:"Point",coordinates:site.coordinates.slice()},properties:p};
  }
  function featureCollection(){ return {type:"FeatureCollection",features:SITES.map(feature)} }
  function validate(){
    const ids=new Set();
    for(const site of SITES){
      if(!site.id||ids.has(site.id)) throw new Error("duplicate or missing archaeology id: "+site.id);
      ids.add(site.id);
      const [lon,lat]=site.coordinates;
      if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<-125||lon>-116.5||lat<45.4||lat>49.1)
        throw new Error("archaeology coordinate outside Washington envelope: "+site.id);
      if(!PRECISION_LABELS[site.precision]) throw new Error("unknown archaeology precision: "+site.id);
      if(!site.sourceIds.length||site.sourceIds.some(id=>!SOURCES[id])) throw new Error("missing archaeology source: "+site.id);
    }
    return {sites:SITES.length,sources:Object.keys(SOURCES).length};
  }

  return Object.freeze({SOURCES,SITES,PRECISION_LABELS,featureCollection,validate});
});
