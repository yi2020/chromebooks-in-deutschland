'use strict';

var $ = require('jquery');
var DataTables = require('datatables.net-dt')();
var DataTablesResponsive = require('datatables.net-responsive-dt')();

import Iconify from '@iconify/iconify';
require("./generated/icon-bundle");
import { expirationData, expirationTimestamp } from "./generated/expiration-data";
import { cpus, resolutions } from "./consts";

var search_field = undefined;
var last_search_term = undefined;

var used_device_model_select = undefined;
var used_device_price_input = undefined;

// take state from history API or from URL hash
const wlhash = window.location.hash.split('#')[1];
const initial_search_term = history.state ? history.state.search : (wlhash ? decodeURIComponent(wlhash) : undefined);

var dt = undefined;
const html_body = $('html, body');

var screenSizesMap = {};
var data = {};
var dataDump = "";

/*
const devices_defaults = {
    id: "default",
    cpu: "default",
    productId: "default",
    expirationId: "default",
    disabled: false,
    flip: false,
    priceUpdated: "1900-01-01T00:00:00.000Z",
    screenGlare: false,
    brand: "default",
    screenResolution: "default",
    screenSize: 0,
    stylus: false,
    screenTouch: false,
    price: 9999999999,
    specLink: "default",
    type: "default",
    memory: 0,
    variant: "default",
    biometricUnlock: false,
    model: "default",
    productProvider: "default",
    extraInfo: "",
    extraLinks: { title: "url"}
  };
*/

const debugMode = window.location.search.includes("debug");

if (debugMode) {
    var debug = (...args) => {
        console.log(...args);
    }
} else {
    var debug = (...args) => { };
}

function getIcon(iconName) {
    return Iconify.getSVG(iconName);
}

function screenResToText(res) {
    if (res in resolutions) {
        return resolutions[res];
    }
    return res;
}

function toNumber(num) {
    return num.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}


function toEuro(num) {
    return num.toLocaleString("de-DE", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + "&nbsp;€";
}

function cpuToText(cpu, notfound = "") {
    try {
        if (cpu in cpus) {
            let burstinfo = ("burst" in cpus[cpu] ? `-${cpus[cpu].burst}` : "");
            return `${cpus[cpu].cores}x ${toNumber(cpus[cpu].frequency)}${burstinfo} GHz`;
        } else {
            return notfound;
        }
    } catch (err) {
        debug(`ERROR looking up CPU >${cpu}<`, err);
        return notfound;
    }
}

function monthDiff(dateFrom, dateTo) {
    // from https://stackoverflow.com/a/4312956/2042547 with some known inprecisions
    return dateTo.getMonth() - dateFrom.getMonth() +
        (12 * (dateTo.getFullYear() - dateFrom.getFullYear()))
}

function encodeEntities(text) {
    return document.createElement('div').appendChild(document.createTextNode(text)).parentNode.innerHTML;
}


function getProductLink(entry) {
    let provider = entry.productProvider;
    let id = entry.productId;
    let url = "";
    switch (provider) {
        case "idealo": url = "https://idealo.de/preisvergleich/OffersOfProduct/" + id; break;
        case "geizhals": url = "https://geizhals.de/-a" + id + ".html"; break;
        case "metacomp": url = "https://shop.metacomp.de/Shop-DE/Produkt-1_" + id; break;
        default: url = "";
    }
    return url;
}

var extraLinkClickHandler = (event) => {
    let a = $(event.target).closest("a");
    let content = a.closest("td").find(".extralinks-content");
    if (content) {
        content.toggle();
        a.toggleClass("extralinks-open");
    } else {
        console.error("ERROR toggling extra links", event);
    }
    event.preventDefault();
}

var renderModel = function (model, type, row) {
    if (type === 'display') {
        let result = $("<p>").text(model);
        let deviceLinks = [
            $("<a>")
                .attr("href", getProductLink(row))
                .attr("title", `Angebote für ${model}`)
                .attr("target", "_blank")
                .html(getIcon("mdi-cart-outline"))
                .attr("rel", "external noopener")
        ];
        if (row.specLink.startsWith("http")) {
            deviceLinks.push(
                $("<a>")
                    .attr("href", row.specLink)
                    .attr("title", `Technische Spezifikation für ${model}`)
                    .attr("target", "_blank")
                    .html(getIcon("mdi-information-outline"))
                    .attr("rel", "external noopener")
            );
        }
        let extraLinksElements = [];
        if (row.extraLinks) {
            debug("Adding extra Links");
            deviceLinks.push(
                $("<a>")
                    .attr("href", "")
                    .addClass("extralinks")
                    .attr("title", `Weitere Links für ${model}`)
                    .attr("data-extralinks", JSON.stringify(row.extraLinks))
                    .html(getIcon("mdi-link"))
            )
            for (const text in row.extraLinks) {
                let url = row.extraLinks[text];
                extraLinksElements.push(`<a href="${url}" target="_blank" rel="external noopener">${text}</a>`);
            }
        }
        result.append($("<div>").addClass("devicelinks").append(...deviceLinks));
        if (extraLinksElements.length > 0) {
            result.append(
                $("<div>")
                    .addClass("extralinks-content")
                    .append(...extraLinksElements)
            )
        }
        model = result.html();
    }
    return model;
};

var renderFeatures = function (features, type, row) {
    if (type === 'display') {
        features = encodeEntities(features).replace(/[\n\r]+/g, "<br>");
    }
    return features;
};

var renderPrice = function (price, type, row) {
    if (type === 'display') {
        price = '<a title="Aktualisiert: ' + new Date(row.priceUpdated).toLocaleString() + '">' + toEuro(price) + '</a>';
    }
    return price;
};

var renderPricePerMonth = function (pricePerMonth, type, row) {
    if (type === 'display') {
        pricePerMonth = `<a title="${row.supportMonths} Monate">${toEuro(pricePerMonth)} (${toEuro(pricePerMonth * 12)})</a>`;
    }
    return pricePerMonth;
};

var renderExpiration = function (expiration, type, row) {
    if (type === 'display') {
        expiration = `<a title="${row.expirationId}">${expiration}</a>`;
    }
    return expiration;
};

function calculatePricesFromExpiration(price, expiration) {
    var result = {};
    var now = new Date();
    result.supportMonths = monthDiff(now, new Date(expiration));
    result.pricePerMonth = price / result.supportMonths;
    result.pricePerYear = result.pricePerMonth * 12;
    return result;
}

function prepareTableData(rawData) {
    let result = [];
    Object.entries(rawData.devices).forEach(([id, entry]) => {
        try {
            if (!(entry.expirationId in expirationData)) {
                throw `Invalid Expiration ID >${entry.expirationId}<!`;
            }

            entry = Object.assign({}, entry); // create copy of entry
            // use YYYY-MM from ISO date string as display date, can be improved
            entry.expirationDate = expirationData[entry.expirationId].expiration
            entry.expiration = entry.expirationDate.substr(0, 7);
            if (!(entry.price && entry.price > 0 && entry.price < 9999)) {
                throw `Invalid price >${price}<!`;
            }
            Object.assign(entry, calculatePricesFromExpiration(entry.price, entry.expirationDate));


            entry.ausstattung = "";
            if (entry.screenSize > 0) {
                // screen info only for chromebooks, else show type
                entry.ausstattung +=
                    toNumber(entry.screenSize) + '" ' +
                    (entry.screenGlare ? "spiegelnd " : "matt ") +
                    screenResToText(entry.screenResolution) + " " +
                    (entry.screenTouch ? "touch " : "") +
                    (entry.flip ? "flip " : "") +
                    (entry.stylus ? "stylus " : "") +
                    (entry.biometricUnlock ? "biometrisch " : "") +
                    "\n";
                screenSizesMap[entry.screenSize] = (entry.screenSize in screenSizesMap ? ++screenSizesMap[entry.screenSize] : 1);
            }
            entry.ausstattung +=
                entry.memory + " GB RAM " +
                entry.cpu + " " + cpuToText(entry.cpu) +
                ("extraInfo" in entry ? "\n" + entry.extraInfo + " " : "")
                ;

            if (entry.disabled && entry.disabled === true) {
                debug(`Disabled ${id}`);
                if (debugMode) {
                    entry.ausstattung += "\nNICHT VERFÜGBAR";
                } else {
                    return; // skip disabled unless in debug mode
                }
            }

            result.push(entry);
        } catch (err) {
            console.error(`ERROR loading >${id}<`, entry, err);
        }
    });
    return result;
}

var loadTableDataFromApi = (rawData) => {
    dataDump = JSON.stringify(rawData, null, 2);
    debug("Read data from database:", rawData);
    data = rawData; // make data globally accessible
    let tableData = prepareTableData(rawData);
    debug("Table data:", tableData);
    return tableData;
};

function persistSearch(search_term) {
    debug(`Persisting >${search_term}<`);
    if (search_term) {
        if (search_term != last_search_term) {
            debug(`Persisting >${search_term}< to browser`);
            history.replaceState(
                { search: search_term },
                document.title,
                window.location.pathname + "#" + encodeURI(search_term)
            );
            last_search_term = search_term;
        } else {
            debug("Ignoring repeat persistSearch call for " + search_term);
        }
    } else {
        debug("Clearing search persistance");
        history.replaceState(
            { search: "" },
            document.title,
            window.location.pathname
        );
        last_search_term = "";
    }
};

function setSearch(search_term) {
    // now in initial loading
    // search_term = decodeURIComponent(search_term);
    debug(`Setting search to >${search_term}<`);
    search_field.val(search_term);
    dt.search(search_term, true, false).draw();
    if (search_term) {
        debug("Scrolling to search");
        html_body.stop().animate({ scrollTop: search_field.offset().top }, 500);
    } else {
        debug("setSearch not scrolling to top");
    }
};

function handleUsedDevice(e) {
    var used_device_model = used_device_model_select.val(),
        used_device_price = used_device_price_input.val(),
        used_device_results = $('#used_device_results'),
        used_device_error = $('#used_device_error');

    if (used_device_model && used_device_price) {
        if (used_device_model in expirationData) {
            const expiration = expirationData[used_device_model].expiration,
                { supportMonths, pricePerMonth, pricePerYear } = calculatePricesFromExpiration(used_device_price, expiration);
            if (pricePerMonth < 0) {
                used_device_error.html(`Das <b>${used_device_model}</b> erhält <b>keine</b> Updates mehr!`).show();
            } else {
                $('#used_device_aue').text(expiration.substr(0, 7));
                $('#used_price_per_month').html(toEuro(pricePerMonth));
                $('#used_price_per_year').html(toEuro(pricePerYear));
                used_device_error.text("").hide();
                used_device_results.show();
            }
        } else {
            used_device_error.text(`Modell ${used_device_model} nicht bekannt`).show();
        }
    } else {
        used_device_results.hide();
        used_device_error.text("").hide();
    }
    e.preventDefault();
}

var stage2setup = function () {
    search_field = $('#chromebooks_filter input');

    if (initial_search_term) {
        try {
            const linkElement = $(`#${initial_search_term}`);
            debug(`Search is actually link element`, linkElement[0]);
            scrollToElement(linkElement[0]);
        } catch {
            debug("Restoring saved search", initial_search_term);
            setSearch(initial_search_term);
        }
    } else {
        // no initial search or link, focus on search input field
        search_field.focus();
    }

    dt.on('search.dt', function (event) {
        persistSearch(dt.search());
    });

    let search_field_div = search_field.parent();
    search_field_div.append(`, z.B. Geräte mit <a class="search" href="">11,6"</a>, <a class="search" href="">14"</a>, <a class="search" href="">15,6"</a> Bildschirm, mit <a class="search" href="">8 GB</a> RAM, <a class="search" href="">Intel Core</a> CPU, einem <a class="search" href="stylus">Stift</a> oder Updates bis <a class="search" href="202(6|7|8|9)-">mind. 2026</a>`);

    $('#AUP_updated').html(` vom ${new Date(expirationTimestamp).toLocaleString()}. Insgesamt ${dt.data().count()} Geräte.`);

    var used_device_form = $('#used_device_form')
    used_device_form.on("mouseover", (e) => {
        require('select2')();
        used_device_model_select.append(
            Object.keys(expirationData).map((entry) => {
                return $("<option>").text(entry)
            })).select2();
        used_device_form.off("mouseover");
    });
}

function scrollToElement(jump) {
    const el = $(jump),
        new_position = el.offset().top,
        id = el.attr("id");
    if (id) {
        persistSearch(id);
    }
    $('html, body').stop().animate({ scrollTop: new_position }, 500);
}

$(document).ready(function () {

    // on-page links implemented via scrolling
    $(document).on("click", ".scroll_to", (event) => {
        var jump = $(event.target).attr('href');
        scrollToElement(jump);
        event.preventDefault();
    });

    // search links
    $(document).on("click", ".search", (event) => {
        let el = $(event.target);
        let href = el.attr("href");
        let text = el.text();
        setSearch(href != "" ? href : text);
        event.preventDefault();
    });

    // links without a class are external and open a new window
    $('a:not([class])').each(function () {
        let el = $(this);
        let target = $(this).attr("target");
        if (!target) {
            $(this).attr("target", "_blank").attr("rel", "external noopener");
        }
    });


    // h1 get a scroll-to-top button
    $('h1').each(function () {
        $(this).append('<button class="scroll_to_top">⬆</button>');
    });

    $(document).on("click", ".scroll_to_top", (event) => {
        $('html, body').stop().animate({ scrollTop: 0 }, 500);
        event.preventDefault();
    });

    // extralinks toggle in table
    $("#chromebooks").on("click", ".extralinks", extraLinkClickHandler);

    window.onpopstate = function (event) {
        debug("onpopstate", event.state);
        if (event.state && "search" in event.state) {
            setSearch(event.state.search);
        }
    };


    dt = $('#chromebooks').DataTable({
        paging: false,
        info: false,
        responsive: true,
        autoWidth: false,
        ajax: {
            url: "api/data",
            cache: true,
            dataType: "json",
            data: initial_search_term ? { search: initial_search_term } : {},
            dataSrc: loadTableDataFromApi,
        },
        columns: [
            {
                title: "Modell",
                data: 'id',
                render: renderModel,
            },
            {
                title: "Ausstattung",
                data: 'ausstattung',
                render: renderFeatures,
            },
            {
                title: "Preis",
                data: 'price',
                render: renderPrice,
            },
            {
                title: "Preis / Monat (/&nbsp;Jahr)",
                data: 'pricePerMonth',
                render: renderPricePerMonth,
            },
            {
                title: "Updates bis",
                data: 'expiration',
                render: renderExpiration,
            },
        ],
        order: [[3, "asc"]],
        language: {
            search: "Suche _INPUT_ in allen Feldern",
            loadingRecords: "Daten werden geladen...",
        },
        search: {
            smart: false
        },
        initComplete: stage2setup,
    });

    used_device_model_select = $('#used_device_model')
        .change(handleUsedDevice);
    used_device_price_input = $('#used_device_price')
        .on("propertychange keyup paste input", handleUsedDevice);

    $('#dump').click(function (e) {
        // transform expiration list into list of model by year
        let expirationModelsByYear = {};
        Object.entries(expirationData).forEach(([id, entry]) => {
            let year = entry.expiration.substr(0, 4);
            if (!(year in expirationModelsByYear)) {
                expirationModelsByYear[year] = {};
            }
            expirationModelsByYear[year][id] = true;
        });

        // remove listed devices
        Object.entries(data.devices).forEach(([id, entry]) => {
            let expirationId = entry.expirationId;
            if (expirationId in expirationData) {
                let year = expirationData[expirationId].expiration.substr(0, 4);
                if (expirationId in expirationModelsByYear[year]) {
                    delete expirationModelsByYear[year][expirationId];
                }
            } else {
                debug(`Invalid expiration ID ${expirationId} for ${id}`);
            }
        });

        debug("expirationModelsByYear", expirationModelsByYear);

        // add last 3 years to dump output
        let interestingYears = Object.keys(expirationModelsByYear).sort().slice(-3);
        let result = [$("<h1>", { text: "Additional Devices" })];
        interestingYears.forEach((year) => {
            let yearContainer = $("<ul>");
            result.push($("<h2>", { text: `Supported till ${year}` }));
            Object.keys(expirationModelsByYear[year]).forEach((id) => {
                let li = $("<li>")
                li.append($("<a>", {
                    text: id,
                    target: "_blank",
                    href: "https://idealo.de/preisvergleich/MainSearchProductCategory.html?q=" + encodeURI(id),
                    title: `Idealo search for ${id}`,
                    rel: "external noopener"
                }))
                yearContainer.append(li);
            });
            result.push(yearContainer);
        });
        result.push(
            $("<h1>", { text: "Data Dump" }),
            $("<pre>").html(dataDump)
        );
        let dumpElement = $(this);
        let footer = dumpElement.parent().parent();
        dumpElement.remove();
        footer.after($("<div>", { class: "dumpzone", html: result }));
    });
});


