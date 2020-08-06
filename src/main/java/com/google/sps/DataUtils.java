package com.google.sps.servlets;

import com.google.appengine.api.datastore.DatastoreService;
import com.google.appengine.api.datastore.DatastoreServiceFactory;
import com.google.appengine.api.datastore.Entity;
import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.datastore.PreparedQuery;
import com.google.appengine.api.datastore.Query;
import com.google.appengine.api.datastore.Query.Filter;
import com.google.appengine.api.datastore.Query.FilterOperator;
import com.google.appengine.api.datastore.Query.FilterPredicate;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/**
 * Provides utilities for servlets interacting with the database
 */
public final class DataUtils {
  public static final String ASCENDING_SORT = "asc";
  public static final String DESCENDING_SORT = "dsc";
  public static final String PRIVATE = "private";
  public static final String PUBLIC = "public";
  public static final String PROJECT = "Project";
  public static final String IMAGE = "Image";
  public static final String MASK = "Mask";

  /**
   * Determines if the given request parameter is empty
   * @param     {String}    param   request parameter
   * @return    {Boolean}
   */
  public static Boolean isEmptyParameter(String param) {
    return param == null || param.isEmpty();
  }

  /**
   * Removes duplicate values with a hash set
   * @param     {ArrayList<String>} al   all values
   * @return    {List<String>}
   */
  public static List<String> withDuplicatesRemoved(ArrayList<String> al) {
    LinkedHashSet<String> lhs = new LinkedHashSet<String>(al);
    return new ArrayList<String>(lhs);
  }

  /**
   * Parses comma-separated list into array
   * @param     {String}            list   unseparated text
   * @return    {ArrayList<String>}
   */
  public static ArrayList<String> parseCommaList(String list) throws IOException {
    return new ArrayList(
        Arrays.asList(list.toLowerCase().split("\\s*,\\s*")));
  }

  public static Boolean parseMode(HttpServletRequest request,
                                  HttpServletResponse response)
      throws IOException {
    String mode = request.getParameter("mode");
    if (isEmptyParameter(mode) || (!mode.toLowerCase().equals("create") &&
                                   !mode.toLowerCase().equals("update"))) {
      throw new IOException("Invalid mode.");
    }
    return mode.toLowerCase().equals("create");
  }

  public static Entity getProjectEntity(Key projKey, String uEmail,
                                        Boolean accessIfEditor,
                                        Boolean accessIfPublic)
      throws IOException {
    DatastoreService datastore = DatastoreServiceFactory.getDatastoreService();

    Entity projEntity = new Entity(PROJECT);
    try {
      projEntity = datastore.get(projKey);
    } catch (Exception e) {
      throw new IOException(
          "You do not have permission to access this project.");
    }

    ArrayList<String> owners =
        (ArrayList<String>)projEntity.getProperty("owners");
    ArrayList<String> editors =
        (ArrayList<String>)projEntity.getProperty("editors");
    String existingVis = (String)projEntity.getProperty("visibility");

    Boolean isOwner = owners.contains(uEmail);
    Boolean isEditor = accessIfEditor && editors != null && editors.contains(uEmail);
    Boolean isPublic = accessIfPublic && existingVis.equals(PUBLIC);

    if (!isOwner && !isEditor && !isPublic) {
      throw new IOException(
          "You do not have permission to access this project.");
    }

    return projEntity;
  }

  private DataUtils() {}
}